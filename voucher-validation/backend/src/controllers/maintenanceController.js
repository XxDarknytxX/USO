// src/controllers/maintenanceController.js
// Service maintenance: a contractor attends a village, walks a fixed checklist,
// photographs each component and files the report. Every 6 months per village.
//
// A visit is a DRAFT while it is being filled in and SUBMITTED once filed.
// Submitted visits are the evidence record: they cannot be edited, and photos
// cannot be added or removed. An admin can reopen one (with a reason, recorded)
// if something was genuinely wrong — that is deliberately an admin action and
// deliberately leaves a trace, because the point of the record is that it says
// what was found on that date.

import {
  COMPONENTS, COMPONENT_KEYS, CONDITIONS,
  savePhoto, streamPhoto, deletePhoto, resolvePhoto,
  ALLOWED_MIME, MAX_BYTES,
  DOC_CATEGORIES, DOC_CATEGORY_KEYS, ALLOWED_DOC_MIME, MAX_DOC_BYTES,
  saveDocument, saveDocumentStream, streamDocument, deleteDocument, resolveDocument,
} from "../services/maintenanceStore.js";

const send = {
  ok: (res, data = {}) => res.json(data),
  created: (res, data = {}) => res.status(201).json(data),
  bad: (res, msg = "Bad request") => res.status(400).json({ error: msg }),
  forbidden: (res, msg = "Not permitted") => res.status(403).json({ error: msg }),
  notFound: (res, msg = "Not found") => res.status(404).json({ error: msg }),
  serverErr: (res, msg = "Internal server error") => res.status(500).json({ error: msg }),
};

// The servicing cadence. Used to derive "next due" and the overdue flag.
const SERVICE_INTERVAL_MONTHS = 6;

const isAdmin = (req) => req.user?.role === "admin";

function mapVisit(r) {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name || null,
    status: r.status,
    visitDate: r.visit_date,
    engineerId: r.engineer_id,
    engineerName: r.engineer_name,
    summary: r.summary,
    overallCondition: r.overall_condition,
    submittedAt: r.submitted_at,
    reopenedAt: r.reopened_at,
    reopenReason: r.reopen_reason,
    createdAt: r.created_at,
    photoCount: r.photo_count == null ? undefined : Number(r.photo_count),
  };
}

export function makeMaintenanceController(pool) {
  return {
    // GET /api/maintenance/components — the checklist, so the UI and the export
    // never drift from what the server validates against.
    getComponents: (_req, res) =>
      send.ok(res, { components: COMPONENTS, conditions: [...CONDITIONS], intervalMonths: SERVICE_INTERVAL_MONTHS }),

    // GET /api/maintenance/schedule
    // Every active village with its last submitted visit and when the next one
    // is due. This is the "are we compliant" view.
    getSchedule: async (_req, res) => {
      try {
        const [rows] = await pool.query(
          `SELECT p.id, p.name, p.hostname,
                  v.id            AS last_visit_id,
                  v.visit_date    AS last_visit_date,
                  v.engineer_name AS last_engineer,
                  v.overall_condition AS last_condition
             FROM network_projects p
             LEFT JOIN maintenance_visits v
                    ON v.id = (
                         SELECT id FROM maintenance_visits
                          WHERE project_id = p.id AND status = 'submitted'
                          ORDER BY visit_date DESC, id DESC LIMIT 1)
            WHERE p.is_active = 1
            ORDER BY p.sort_order, p.name`
        );
        const now = new Date();
        const sites = rows.map((r) => {
          let nextDue = null;
          if (r.last_visit_date) {
            const d = new Date(r.last_visit_date);
            d.setMonth(d.getMonth() + SERVICE_INTERVAL_MONTHS);
            nextDue = d;
          }
          const daysUntilDue =
            nextDue == null ? null : Math.round((nextDue - now) / 86400000);
          return {
            projectId: r.id,
            name: r.name,
            hostname: r.hostname,
            lastVisitId: r.last_visit_id,
            lastVisitDate: r.last_visit_date,
            lastEngineer: r.last_engineer,
            lastCondition: r.last_condition,
            nextDue,
            daysUntilDue,
            // No visit ever = overdue. A village nobody has serviced is the
            // case this whole feature exists to surface, so it must not read
            // as "fine" just because there is no date to compare against.
            overdue: r.last_visit_date == null || (daysUntilDue != null && daysUntilDue < 0),
            neverServiced: r.last_visit_date == null,
          };
        });
        return send.ok(res, {
          sites,
          intervalMonths: SERVICE_INTERVAL_MONTHS,
          overdueCount: sites.filter((s) => s.overdue).length,
        });
      } catch (e) { console.error('[maintenance] schedule:', e); return send.serverErr(res); }
    },

    // GET /api/maintenance/villages/:projectId/profile
    //
    // The village as a THING, not as a stack of reports. For each component:
    // what condition is it in right now, when was that established, who by, and
    // the photographs. Plus the paperwork that belongs to the site rather than
    // to any one visit.
    //
    // "Right now" = the most recent SUBMITTED check for that component, across
    // every visit. A component nobody has ever filed reads as never inspected,
    // which is a finding in itself.
    getVillageProfile: async (req, res) => {
      try {
        const projectId = Number(req.params.projectId);
        if (!Number.isFinite(projectId)) return send.bad(res, 'A numeric village id is required');

        const [[project]] = await pool.query(
          'SELECT id, name, hostname, ruijie_group_id FROM network_projects WHERE id = ? LIMIT 1', [projectId]
        );
        if (!project) return send.notFound(res, 'No such village');

        // Newest first, so the first row seen per component is the current one.
        const [rows] = await pool.query(
          `SELECT ck.visit_id, ck.component_key, ck.condition_rating, ck.notes,
                  ck.submitted_at, v.visit_date, v.engineer_name
             FROM maintenance_checks ck
             JOIN maintenance_visits v ON v.id = ck.visit_id
            WHERE v.project_id = ? AND ck.status = 'submitted'
            ORDER BY ck.submitted_at DESC, ck.id DESC`,
          [projectId]
        );
        const [photos] = await pool.query(
          `SELECT ph.id, ph.visit_id, ph.component_key, ph.caption, ph.uploaded_at
             FROM maintenance_photos ph
             JOIN maintenance_visits v ON v.id = ph.visit_id
            WHERE v.project_id = ?
            ORDER BY ph.id DESC`,
          [projectId]
        );

        const history = {};
        for (const r of rows) (history[r.component_key] ||= []).push(r);

        // The caller's own open draft for this village, if any. The profile is
        // where servicing happens now, so it has to show work in progress as
        // well as what is filed — otherwise an engineer who photographed the
        // gateway yesterday would come back and see no trace of it.
        const [[openDraft]] = await pool.query(
          `SELECT id, visit_date FROM maintenance_visits
            WHERE project_id = ? AND status = 'draft' AND engineer_id = ?
            ORDER BY id DESC LIMIT 1`,
          [projectId, req.user?.id ?? 0]
        );
        let draftChecks = [], draftPhotos = [];
        if (openDraft) {
          [draftChecks] = await pool.query(
            `SELECT component_key, condition_rating, notes, status
               FROM maintenance_checks WHERE visit_id = ?`, [openDraft.id]
          );
          [draftPhotos] = await pool.query(
            `SELECT id, component_key, caption FROM maintenance_photos
              WHERE visit_id = ? ORDER BY id`, [openDraft.id]
          );
        }
        const draftByKey = Object.fromEntries(draftChecks.map((c) => [c.component_key, c]));

        const components = COMPONENTS.map((c) => {
          const past = history[c.key] || [];
          const current = past[0] || null;
          return {
            key: c.key,
            label: c.label,
            hint: c.hint,
            condition: current?.condition_rating || null,
            notes: current?.notes || '',
            lastInspected: current?.submitted_at || null,
            lastVisitDate: current?.visit_date || null,
            engineerName: current?.engineer_name || null,
            visitId: current?.visit_id || null,
            neverInspected: past.length === 0,
            // Photos from the visit that established the CURRENT state, so the
            // gallery matches the condition shown beside it.
            photos: current
              ? photos.filter((p) => p.visit_id === current.visit_id && p.component_key === c.key)
                      .map((p) => ({ id: p.id, caption: p.caption, uploadedAt: p.uploaded_at }))
              : [],
            // Unfiled work on this component in the caller's open draft.
            draft: openDraft
              ? {
                  visitId: openDraft.id,
                  condition: draftByKey[c.key]?.condition_rating || null,
                  notes: draftByKey[c.key]?.notes || '',
                  // A submitted check inside the open draft is already filed;
                  // it appears above as current state, not as pending work.
                  pending: (draftByKey[c.key]?.status || 'draft') !== 'submitted',
                  photos: draftPhotos
                    .filter((p) => p.component_key === c.key)
                    .map((p) => ({ id: p.id, caption: p.caption })),
                }
              : null,
            history: past.map((h) => ({
              visitId: h.visit_id,
              condition: h.condition_rating,
              notes: h.notes,
              submittedAt: h.submitted_at,
              visitDate: h.visit_date,
              engineerName: h.engineer_name,
              photoCount: photos.filter((p) => p.visit_id === h.visit_id && p.component_key === c.key).length,
            })),
          };
        });


        const [docs] = await pool.query(
          `SELECT id, category, title, notes, file_name, mime_type, bytes, uploaded_at
             FROM maintenance_documents WHERE project_id = ?
            ORDER BY uploaded_at DESC, id DESC`,
          [projectId]
        );

        const [[lastVisit]] = await pool.query(
          `SELECT id, visit_date, engineer_name, overall_condition, submitted_at
             FROM maintenance_visits
            WHERE project_id = ? AND status = 'submitted'
            ORDER BY visit_date DESC, id DESC LIMIT 1`,
          [projectId]
        );
        let nextDue = null;
        if (lastVisit?.visit_date) {
          const d = new Date(lastVisit.visit_date);
          d.setMonth(d.getMonth() + SERVICE_INTERVAL_MONTHS);
          nextDue = d;
        }
        const rated = components.filter((c) => c.condition && c.condition !== 'na');

        return send.ok(res, {
          village: {
            id: project.id,
            name: project.name,
            hostname: project.hostname,
            groupId: project.ruijie_group_id,
          },
          service: {
            lastVisitId: lastVisit?.id || null,
            lastVisitDate: lastVisit?.visit_date || null,
            lastEngineer: lastVisit?.engineer_name || null,
            overallCondition: lastVisit?.overall_condition || null,
            nextDue,
            overdue: !lastVisit || (nextDue != null && nextDue < new Date()),
            neverServiced: !lastVisit,
            intervalMonths: SERVICE_INTERVAL_MONTHS,
          },
          summary: {
            total: components.length,
            inspected: components.filter((c) => !c.neverInspected).length,
            faulty: rated.filter((c) => c.condition === 'faulty').length,
            attention: rated.filter((c) => c.condition === 'attention').length,
            ok: rated.filter((c) => c.condition === 'ok').length,
          },
          components,
          openDraftId: openDraft?.id || null,
          documents: docs.map((d) => ({
            id: d.id, category: d.category, title: d.title, notes: d.notes,
            fileName: d.file_name, mimeType: d.mime_type, bytes: d.bytes, uploadedAt: d.uploaded_at,
          })),
          documentCategories: DOC_CATEGORIES,
        });
      } catch (e) { console.error('[maintenance] profile:', e); return send.serverErr(res); }
    },

    // POST /api/maintenance/villages/:projectId/documents
    //   ?title=&category=&notes=&fileName=   metadata in the query string
    //   Content-Type: <the file's own type>  the body IS the file
    //
    // The body is streamed to disk, not parsed. Metadata rides in the query
    // string precisely so the body can stay a raw byte stream — see
    // saveDocumentStream for why base64-in-JSON was the wrong shape here.
    // server.js deliberately does not mount express.json on this route.
    addDocument: async (req, res) => {
      try {
        const projectId = Number(req.params.projectId);
        if (!Number.isFinite(projectId)) return send.bad(res, 'A numeric village id is required');
        const [[project]] = await pool.query('SELECT id FROM network_projects WHERE id = ? LIMIT 1', [projectId]);
        if (!project) return send.notFound(res, 'No such village');

        const q = req.query || {};
        const fileName = String(q.fileName || '').slice(0, 255);
        const title = (String(q.title || '').trim() || fileName.replace(/\.[^.]+$/, '')).slice(0, 255);
        if (!title) return send.bad(res, 'A title is required');
        const category = DOC_CATEGORY_KEYS.has(q.category) ? q.category : 'other';

        // Content-Type carries parameters (";charset=") on some clients.
        const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim();
        if (!ALLOWED_DOC_MIME.includes(mimeType)) {
          return send.bad(res, `Unsupported file type: ${mimeType || 'unknown'}`);
        }

        let saved;
        try {
          saved = await saveDocumentStream(projectId, req, mimeType);
        } catch (e) {
          if (e.code === 'DOC_TOO_LARGE' || e.code === 'DOC_EMPTY') return send.bad(res, e.message);
          throw e;
        }

        const [r] = await pool.query(
          `INSERT INTO maintenance_documents
             (project_id, category, title, notes, file_path, file_name, mime_type, bytes, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [projectId, category, title, String(q.notes || '').slice(0, 500) || null,
           saved.rel, fileName || null, mimeType, saved.bytes, req.user?.id ?? null]
        );
        return send.created(res, { documentId: r.insertId, bytes: saved.bytes });
      } catch (e) { console.error('[maintenance] addDocument:', e); return send.serverErr(res, e.message); }
    },

    // GET /api/maintenance/documents/:id — streams it, behind auth like photos.
    getDocument: async (req, res) => {
      try {
        const id = Number(req.params.id);
        const [[d]] = await pool.query(
          'SELECT file_path, file_name, mime_type FROM maintenance_documents WHERE id = ? LIMIT 1', [id]
        );
        if (!d || !resolveDocument(d.file_path)) return send.notFound(res, 'No such document');
        const stream = streamDocument(d.file_path);
        if (!stream) return send.notFound(res, 'No such document');
        res.setHeader('Content-Type', d.mime_type || 'application/octet-stream');
        // inline, not attachment: a PDF handover pack should open in the viewer
        // rather than force a download the operator then has to find.
        const safeName = String(d.file_name || 'document').replace(/[^\w.\- ]/g, '_');
        res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
        stream.on('error', () => { if (!res.headersSent) res.status(404).end(); else res.end(); });
        return stream.pipe(res);
      } catch (e) { console.error('[maintenance] getDocument:', e); return send.serverErr(res); }
    },

    // DELETE /api/maintenance/documents/:id — admin only.
    removeDocument: async (req, res) => {
      try {
        const id = Number(req.params.id);
        const [[d]] = await pool.query('SELECT file_path FROM maintenance_documents WHERE id = ? LIMIT 1', [id]);
        if (!d) return send.notFound(res, 'No such document');
        await pool.query('DELETE FROM maintenance_documents WHERE id = ?', [id]);
        await deleteDocument(d.file_path);
        return send.ok(res, { success: true });
      } catch (e) { console.error('[maintenance] removeDocument:', e); return send.serverErr(res); }
    },

    // GET /api/maintenance/visits?projectId=&status=&limit=
    listVisits: async (req, res) => {
      try {
        const where = [];
        const params = [];
        if (req.query.projectId) { where.push('v.project_id = ?'); params.push(Number(req.query.projectId)); }
        if (req.query.status === 'draft' || req.query.status === 'submitted') {
          where.push('v.status = ?'); params.push(req.query.status);
        }
        // An engineer sees their own drafts plus every submitted report; they
        // must not see another contractor's unfiled working notes.
        if (!isAdmin(req)) {
          where.push("(v.status = 'submitted' OR v.engineer_id = ?)");
          params.push(req.user?.id ?? 0);
        }
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const [rows] = await pool.query(
          `SELECT v.*, p.name AS project_name,
                  (SELECT COUNT(*) FROM maintenance_photos ph WHERE ph.visit_id = v.id) AS photo_count
             FROM maintenance_visits v
             LEFT JOIN network_projects p ON p.id = v.project_id
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            ORDER BY v.visit_date DESC, v.id DESC
            LIMIT ?`,
          [...params, limit]
        );
        return send.ok(res, { visits: rows.map(mapVisit) });
      } catch (e) { console.error('[maintenance] listVisits:', e); return send.serverErr(res); }
    },

    // GET /api/maintenance/visits/:id — the full report: checks + photos.
    getVisit: async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return send.bad(res, 'A numeric visit id is required');
        const [[v]] = await pool.query(
          `SELECT v.*, p.name AS project_name FROM maintenance_visits v
             LEFT JOIN network_projects p ON p.id = v.project_id
            WHERE v.id = ? LIMIT 1`, [id]
        );
        if (!v) return send.notFound(res, 'No such visit');
        if (!isAdmin(req) && v.status !== 'submitted' && v.engineer_id !== req.user?.id) {
          return send.forbidden(res, "That draft belongs to another engineer");
        }
        const [checks] = await pool.query(
          `SELECT component_key, condition_rating, notes, status, submitted_at, reopen_reason
             FROM maintenance_checks WHERE visit_id = ?`, [id]
        );
        const [photos] = await pool.query(
          `SELECT id, component_key, caption, mime_type, bytes, uploaded_at
             FROM maintenance_photos WHERE visit_id = ? ORDER BY id`, [id]
        );
        const byKey = Object.fromEntries(checks.map((c) => [c.component_key, c]));
        return send.ok(res, {
          visit: mapVisit(v),
          // Always the full checklist, so a component nobody filled in shows as
          // an unanswered row rather than silently vanishing from the report.
          checks: COMPONENTS.map((c) => ({
            key: c.key,
            label: c.label,
            hint: c.hint,
            condition: byKey[c.key]?.condition_rating || 'na',
            notes: byKey[c.key]?.notes || '',
            status: byKey[c.key]?.status || 'draft',
            submittedAt: byKey[c.key]?.submitted_at || null,
            reopenReason: byKey[c.key]?.reopen_reason || null,
            photos: photos.filter((p) => p.component_key === c.key)
              .map((p) => ({ id: p.id, caption: p.caption, uploadedAt: p.uploaded_at })),
          })),
          generalPhotos: photos.filter((p) => p.component_key == null)
            .map((p) => ({ id: p.id, caption: p.caption, uploadedAt: p.uploaded_at })),
        });
      } catch (e) { console.error('[maintenance] getVisit:', e); return send.serverErr(res); }
    },

    // POST /api/maintenance/visits { projectId, visitDate }
    createVisit: async (req, res) => {
      try {
        const projectId = Number(req.body?.projectId);
        if (!Number.isFinite(projectId)) return send.bad(res, 'projectId is required');
        const [[proj]] = await pool.query(
          'SELECT id FROM network_projects WHERE id = ? AND is_active = 1 LIMIT 1', [projectId]
        );
        if (!proj) return send.bad(res, 'No such active village');

        const raw = String(req.body?.visitDate || '').trim();
        const visitDate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);

        // One open draft per engineer per village: reattaching to it stops a
        // flaky connection from scattering half-filled reports.
        const [[existing]] = await pool.query(
          `SELECT id FROM maintenance_visits
            WHERE project_id = ? AND status = 'draft' AND engineer_id = ? LIMIT 1`,
          [projectId, req.user?.id ?? 0]
        );
        if (existing) return send.ok(res, { visitId: existing.id, reused: true });

        const [r] = await pool.query(
          `INSERT INTO maintenance_visits (project_id, status, visit_date, engineer_id, engineer_name)
           VALUES (?, 'draft', ?, ?, ?)`,
          [projectId, visitDate, req.user?.id ?? null, req.user?.name || req.user?.email || null]
        );
        return send.created(res, { visitId: r.insertId, reused: false });
      } catch (e) { console.error('[maintenance] createVisit:', e); return send.serverErr(res); }
    },

    // PUT /api/maintenance/visits/:id { visitDate?, summary?, checks:[{key,condition,notes}] }
    updateVisit: async (req, res) => {
      try {
        const id = Number(req.params.id);
        const [[v]] = await pool.query('SELECT * FROM maintenance_visits WHERE id = ? LIMIT 1', [id]);
        if (!v) return send.notFound(res, 'No such visit');
        if (v.status === 'submitted') {
          return send.forbidden(res, 'This report is filed and cannot be edited. An admin can reopen it.');
        }
        if (!isAdmin(req) && v.engineer_id !== req.user?.id) {
          return send.forbidden(res, "That draft belongs to another engineer");
        }

        const fields = [];
        const params = [];
        const raw = String(req.body?.visitDate || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) { fields.push('visit_date = ?'); params.push(raw); }
        if (req.body?.summary !== undefined) { fields.push('summary = ?'); params.push(String(req.body.summary || '').slice(0, 65535)); }
        if (fields.length) await pool.query(`UPDATE maintenance_visits SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);

        const checks = Array.isArray(req.body?.checks) ? req.body.checks : [];
        for (const c of checks) {
          if (!COMPONENT_KEYS.has(c?.key)) continue;           // ignore unknown components
          const cond = CONDITIONS.has(c?.condition) ? c.condition : 'na';
          // A submitted component is evidence and does not move. The WHERE on
          // the UPDATE half is what enforces that, so a stale browser holding
          // an old draft cannot overwrite something already filed.
          await pool.query(
            `INSERT INTO maintenance_checks (visit_id, component_key, condition_rating, notes)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               condition_rating = IF(status = 'submitted', condition_rating, VALUES(condition_rating)),
               notes            = IF(status = 'submitted', notes, VALUES(notes))`,
            [id, c.key, cond, String(c?.notes || '').slice(0, 65535)]
          );
        }
        return send.ok(res, { success: true });
      } catch (e) { console.error('[maintenance] updateVisit:', e); return send.serverErr(res); }
    },

    // POST /api/maintenance/visits/:id/photos { componentKey?, caption?, mimeType, dataBase64 }
    // Photos arrive base64 in JSON, already downscaled by the browser. That
    // avoids a multipart dependency and, more importantly, keeps the upload
    // small on a rural link — a raw 5 MB phone photo over village Wi-Fi is the
    // difference between a report filed and a report abandoned.
    addPhoto: async (req, res) => {
      try {
        const id = Number(req.params.id);
        const [[v]] = await pool.query('SELECT * FROM maintenance_visits WHERE id = ? LIMIT 1', [id]);
        if (!v) return send.notFound(res, 'No such visit');
        if (v.status === 'submitted') {
          return send.forbidden(res, 'This report is filed — photos cannot be added or removed.');
        }
        if (!isAdmin(req) && v.engineer_id !== req.user?.id) {
          return send.forbidden(res, "That draft belongs to another engineer");
        }

        const componentKey = req.body?.componentKey ? String(req.body.componentKey) : null;
        if (componentKey && !COMPONENT_KEYS.has(componentKey)) return send.bad(res, 'Unknown component');
        if (componentKey) {
          const [[chk]] = await pool.query(
            'SELECT status FROM maintenance_checks WHERE visit_id = ? AND component_key = ? LIMIT 1',
            [id, componentKey]
          );
          if (chk?.status === 'submitted') {
            return send.forbidden(res, 'That component is filed — its photos are locked.');
          }
        }
        const mimeType = String(req.body?.mimeType || 'image/jpeg');
        if (!ALLOWED_MIME.includes(mimeType)) return send.bad(res, `Unsupported image type: ${mimeType}`);

        const b64 = String(req.body?.dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
        if (!b64) return send.bad(res, 'No image data');
        let buf;
        try { buf = Buffer.from(b64, 'base64'); } catch { return send.bad(res, 'Image data is not valid base64'); }
        if (!buf.length) return send.bad(res, 'Image data is empty');
        if (buf.length > MAX_BYTES) {
          return send.bad(res, `Image is too large (${Math.round(buf.length / 1048576)} MB, max ${MAX_BYTES / 1048576} MB)`);
        }

        const rel = await savePhoto(id, buf, mimeType);
        const [r] = await pool.query(
          `INSERT INTO maintenance_photos (visit_id, component_key, file_path, mime_type, bytes, caption, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, componentKey, rel, mimeType, buf.length, String(req.body?.caption || '').slice(0, 255) || null, req.user?.id ?? null]
        );
        return send.created(res, { photoId: r.insertId, bytes: buf.length });
      } catch (e) { console.error('[maintenance] addPhoto:', e); return send.serverErr(res, e.message); }
    },

    // GET /api/maintenance/photos/:id — streams the file. Served through the API
    // rather than as a static directory so it stays behind authentication.
    getPhoto: async (req, res) => {
      try {
        const id = Number(req.params.id);
        const [[p]] = await pool.query(
          'SELECT file_path, mime_type FROM maintenance_photos WHERE id = ? LIMIT 1', [id]
        );
        if (!p) return send.notFound(res, 'No such photo');
        if (!resolvePhoto(p.file_path)) return send.notFound(res, 'No such photo');
        const stream = streamPhoto(p.file_path);
        if (!stream) return send.notFound(res, 'No such photo');
        res.setHeader('Content-Type', p.mime_type || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        stream.on('error', () => { if (!res.headersSent) res.status(404).end(); else res.end(); });
        return stream.pipe(res);
      } catch (e) { console.error('[maintenance] getPhoto:', e); return send.serverErr(res); }
    },

    // DELETE /api/maintenance/photos/:id — drafts only.
    deletePhoto: async (req, res) => {
      try {
        const id = Number(req.params.id);
        const [[p]] = await pool.query(
          `SELECT ph.id, ph.file_path, ph.component_key, v.status, v.engineer_id,
                  ck.status AS check_status
             FROM maintenance_photos ph
             JOIN maintenance_visits v ON v.id = ph.visit_id
             LEFT JOIN maintenance_checks ck
                    ON ck.visit_id = ph.visit_id AND ck.component_key = ph.component_key
            WHERE ph.id = ? LIMIT 1`, [id]
        );
        if (!p) return send.notFound(res, 'No such photo');
        if (p.status === 'submitted') return send.forbidden(res, 'This report is filed — photos cannot be removed.');
        if (p.check_status === 'submitted') return send.forbidden(res, 'That component is filed — its photos are locked.');
        if (!isAdmin(req) && p.engineer_id !== req.user?.id) return send.forbidden(res, "That draft belongs to another engineer");
        await pool.query('DELETE FROM maintenance_photos WHERE id = ?', [id]);
        await deletePhoto(p.file_path);
        return send.ok(res, { success: true });
      } catch (e) { console.error('[maintenance] deletePhoto:', e); return send.serverErr(res); }
    },

    // POST /api/maintenance/visits/:id/checks/:key/submit
    // Files ONE component. The engineer inspects the AP today and the gateway
    // when that information is to hand — there is no reason to hold seven
    // findings hostage to the last one. Submitting locks that component; the
    // visit finalises by itself once all of them are in.
    submitCheck: async (req, res) => {
      try {
        const id = Number(req.params.id);
        const key = String(req.params.key || '');
        if (!COMPONENT_KEYS.has(key)) return send.bad(res, 'Unknown component');

        const [[v]] = await pool.query('SELECT * FROM maintenance_visits WHERE id = ? LIMIT 1', [id]);
        if (!v) return send.notFound(res, 'No such visit');
        if (!isAdmin(req) && v.engineer_id !== req.user?.id) return send.forbidden(res, "That draft belongs to another engineer");

        const [[chk]] = await pool.query(
          'SELECT * FROM maintenance_checks WHERE visit_id = ? AND component_key = ? LIMIT 1', [id, key]
        );
        if (!chk) return send.bad(res, 'Fill this component in before filing it');
        if (chk.status === 'submitted') return send.bad(res, 'That component is already filed');

        const [[{ n: photoCount }]] = await pool.query(
          'SELECT COUNT(*) AS n FROM maintenance_photos WHERE visit_id = ? AND component_key = ?', [id, key]
        );
        // "Not applicable" is a legitimate finding — a village with no switch
        // must still be completable — but it has to say why, since there is no
        // photograph to speak for it.
        if (chk.condition_rating === 'na') {
          if (!String(chk.notes || '').trim()) {
            return send.bad(res, 'Say why this component is not applicable before filing it');
          }
        } else if (!photoCount) {
          return send.bad(res, 'At least one photo is needed before filing this component');
        }

        await pool.query(
          `UPDATE maintenance_checks
              SET status = 'submitted', submitted_at = NOW(), submitted_by = ?
            WHERE visit_id = ? AND component_key = ? AND status = 'draft'`,
          [req.user?.id ?? null, id, key]
        );

        // Finalise the visit when every component is in, so nobody has to
        // remember a separate "file the report" step.
        const [rows] = await pool.query(
          `SELECT component_key, condition_rating FROM maintenance_checks
            WHERE visit_id = ? AND status = 'submitted'`, [id]
        );
        const done = new Set(rows.map((r) => r.component_key));
        const remaining = COMPONENTS.filter((c) => !done.has(c.key));
        let finalised = false;
        if (remaining.length === 0) {
          const rated = rows.filter((r) => r.condition_rating !== 'na');
          const overall = rated.some((r) => r.condition_rating === 'faulty')
            ? 'faulty'
            : rated.some((r) => r.condition_rating === 'attention') ? 'attention' : 'ok';
          const [u] = await pool.query(
            `UPDATE maintenance_visits SET status = 'submitted', submitted_at = NOW(), overall_condition = ?
              WHERE id = ? AND status = 'draft'`, [overall, id]
          );
          finalised = u.affectedRows > 0;
        }
        return send.ok(res, {
          success: true,
          remaining: remaining.map((c) => c.label),
          submittedCount: done.size,
          totalCount: COMPONENTS.length,
          visitFinalised: finalised,
        });
      } catch (e) { console.error('[maintenance] submitCheck:', e); return send.serverErr(res); }
    },

    // POST /api/maintenance/visits/:id/checks/:key/reopen { reason } — admin.
    // Reopening a component also un-finalises the visit: the report as a whole
    // is no longer complete while one of its findings is being revised.
    reopenCheck: async (req, res) => {
      try {
        const id = Number(req.params.id);
        const key = String(req.params.key || '');
        const reason = String(req.body?.reason || '').trim();
        if (!COMPONENT_KEYS.has(key)) return send.bad(res, 'Unknown component');
        if (!reason) return send.bad(res, 'A reason is required to reopen a filed component');
        const [r] = await pool.query(
          `UPDATE maintenance_checks
              SET status = 'draft', reopened_at = NOW(), reopen_reason = ?
            WHERE visit_id = ? AND component_key = ? AND status = 'submitted'`,
          [reason.slice(0, 500), id, key]
        );
        if (!r.affectedRows) return send.bad(res, 'That component is not filed');
        await pool.query(
          `UPDATE maintenance_visits SET status = 'draft', overall_condition = NULL
            WHERE id = ? AND status = 'submitted'`, [id]
        );
        return send.ok(res, { success: true });
      } catch (e) { console.error('[maintenance] reopenCheck:', e); return send.serverErr(res); }
    },

    // DELETE /api/maintenance/visits/:id — drafts only, owner or admin.
    // Removes the photo files too: leaving orphans on disk would grow the data
    // directory forever with nothing pointing at them.
    deleteVisit: async (req, res) => {
      try {
        const id = Number(req.params.id);
        const [[v]] = await pool.query('SELECT * FROM maintenance_visits WHERE id = ? LIMIT 1', [id]);
        if (!v) return send.notFound(res, 'No such visit');
        if (v.status === 'submitted') {
          return send.forbidden(res, 'Filed reports cannot be deleted. An admin can reopen one instead.');
        }
        if (!isAdmin(req) && v.engineer_id !== req.user?.id) {
          return send.forbidden(res, "That draft belongs to another engineer");
        }
        const [photos] = await pool.query('SELECT file_path FROM maintenance_photos WHERE visit_id = ?', [id]);
        await pool.query('DELETE FROM maintenance_photos WHERE visit_id = ?', [id]);
        await pool.query('DELETE FROM maintenance_checks WHERE visit_id = ?', [id]);
        await pool.query('DELETE FROM maintenance_visits WHERE id = ?', [id]);
        for (const p of photos) await deletePhoto(p.file_path);
        return send.ok(res, { success: true, photosRemoved: photos.length });
      } catch (e) { console.error('[maintenance] deleteVisit:', e); return send.serverErr(res); }
    },

    // GET /api/maintenance/submissions?projectId=&component=&limit=
    // Every filed COMPONENT across every visit, newest first. The visit view
    // answers "what happened on this attendance"; this answers "when was the
    // Starlink dish last looked at, anywhere".
    listSubmissions: async (req, res) => {
      try {
        const where = ["ck.status = 'submitted'"];
        const params = [];
        if (req.query.projectId) { where.push('v.project_id = ?'); params.push(Number(req.query.projectId)); }
        if (req.query.component && COMPONENT_KEYS.has(String(req.query.component))) {
          where.push('ck.component_key = ?'); params.push(String(req.query.component));
        }
        const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
        const [rows] = await pool.query(
          `SELECT ck.visit_id, ck.component_key, ck.condition_rating, ck.notes, ck.submitted_at,
                  v.project_id, v.visit_date, v.engineer_name, p.name AS project_name,
                  (SELECT COUNT(*) FROM maintenance_photos ph
                    WHERE ph.visit_id = ck.visit_id AND ph.component_key = ck.component_key) AS photo_count
             FROM maintenance_checks ck
             JOIN maintenance_visits v ON v.id = ck.visit_id
             LEFT JOIN network_projects p ON p.id = v.project_id
            WHERE ${where.join(' AND ')}
            ORDER BY ck.submitted_at DESC, ck.id DESC
            LIMIT ?`,
          [...params, limit]
        );
        const labels = Object.fromEntries(COMPONENTS.map((c) => [c.key, c.label]));
        return send.ok(res, {
          submissions: rows.map((r) => ({
            visitId: r.visit_id,
            projectId: r.project_id,
            projectName: r.project_name,
            component: r.component_key,
            componentLabel: labels[r.component_key] || r.component_key,
            condition: r.condition_rating,
            notes: r.notes,
            submittedAt: r.submitted_at,
            visitDate: r.visit_date,
            engineerName: r.engineer_name,
            photoCount: Number(r.photo_count || 0),
          })),
        });
      } catch (e) { console.error('[maintenance] listSubmissions:', e); return send.serverErr(res); }
    },

    // POST /api/maintenance/visits/:id/submit — files the report.
    submitVisit: async (req, res) => {
      try {
        const id = Number(req.params.id);
        const [[v]] = await pool.query('SELECT * FROM maintenance_visits WHERE id = ? LIMIT 1', [id]);
        if (!v) return send.notFound(res, 'No such visit');
        if (v.status === 'submitted') return send.bad(res, 'Already filed');
        if (!isAdmin(req) && v.engineer_id !== req.user?.id) return send.forbidden(res, "That draft belongs to another engineer");

        const [checks] = await pool.query(
          "SELECT component_key, condition_rating FROM maintenance_checks WHERE visit_id = ? AND condition_rating <> 'na'", [id]
        );
        const answered = new Set(checks.map((c) => c.component_key));
        const missing = COMPONENTS.filter((c) => !answered.has(c.key));
        if (missing.length) {
          return send.bad(res, `Every component needs a condition before filing. Still unanswered: ${missing.map((m) => m.label).join(', ')}`);
        }
        const [[{ n: photoCount }]] = await pool.query(
          'SELECT COUNT(*) AS n FROM maintenance_photos WHERE visit_id = ?', [id]
        );
        // The report is evidence; evidence without a photo is just an assertion.
        if (!photoCount) return send.bad(res, 'At least one photo is required before filing.');

        // Worst rating wins: one faulty component makes the site faulty.
        const overall = checks.some((c) => c.condition_rating === 'faulty')
          ? 'faulty'
          : checks.some((c) => c.condition_rating === 'attention') ? 'attention' : 'ok';

        await pool.query(
          `UPDATE maintenance_visits
              SET status = 'submitted', submitted_at = NOW(), overall_condition = ?
            WHERE id = ? AND status = 'draft'`,
          [overall, id]
        );
        return send.ok(res, { success: true, overallCondition: overall, photoCount: Number(photoCount) });
      } catch (e) { console.error('[maintenance] submitVisit:', e); return send.serverErr(res); }
    },

    // POST /api/maintenance/visits/:id/reopen { reason } — admin only.
    reopenVisit: async (req, res) => {
      try {
        const id = Number(req.params.id);
        const reason = String(req.body?.reason || '').trim();
        if (!reason) return send.bad(res, 'A reason is required to reopen a filed report');
        const [r] = await pool.query(
          `UPDATE maintenance_visits
              SET status = 'draft', reopened_at = NOW(), reopened_by = ?, reopen_reason = ?
            WHERE id = ? AND status = 'submitted'`,
          [req.user?.id ?? null, reason.slice(0, 500), id]
        );
        if (!r.affectedRows) return send.bad(res, 'That report is not in a filed state');
        return send.ok(res, { success: true });
      } catch (e) { console.error('[maintenance] reopenVisit:', e); return send.serverErr(res); }
    },
  };
}
