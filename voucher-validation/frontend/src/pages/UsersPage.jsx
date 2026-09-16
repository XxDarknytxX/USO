// src/pages/UsersPage.jsx
// Console accounts: who can sign in, what they are allowed to see, and how
// they get their first password.
//
// The list is one table rather than a card per person, and the role counts live
// in the filter itself instead of a row of KPI tiles — on a page with a handful
// of accounts, a tile that says "3 admins" is a tile that only tells you
// something the filter already had to know.
//
// What the table DOES spend a column on is state. An account waiting on an
// invite, an account whose invite went stale, and an account somebody is using
// every day look identical if all you list is a name and a role — and only one
// of the three is finished.

import { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import {
  Users, UserPlus, Trash2, Shield, Eye, EyeOff, Edit3, RefreshCw, KeyRound,
  ShieldOff, Send, Check, MapPin, Wrench, Globe2, Mail, User as UserIcon,
  ArrowRight, ArrowLeft, MailCheck, AlertTriangle, Copy, Clock, Search,
  LayoutDashboard, Gauge, Dices,
} from "lucide-react";

import { userApi, networkApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import ConfirmDialog from "../components/shared/ConfirmDialog";
import {
  Modal, Field, Input, Button, IconButton, EmptyState, PageShell, PageHeader,
  Panel, Toolbar, SearchInput, Segmented, DataTable, Th, Td, TableMessage,
  RecordCell, StatusPill, SkeletonTable,
} from "../components/ui";

function generatePassword(len = 14) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let pw = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) pw += chars[arr[i] % chars.length];
  return pw;
}

/* ============================================================================
   The roles, described once.
   The list, the filter and the modal all read from here, so a role can never
   pick up a different colour or a different promise on a different screen.

   `opens` is the load-bearing field. "Read-only access" tells an admin the
   shape of the permission; it does not tell them which tabs the person will
   actually find when they sign in, which is the thing being decided.
   ========================================================================= */
const ROLES = {
  viewer: {
    label: "Viewer",
    icon: Eye,
    tone: "info",
    tile: "blue",
    blurb: "Reads the numbers for the villages you choose. Changes nothing, anywhere.",
    opens: [
      { label: "Dashboard", Icon: LayoutDashboard },
      { label: "Overview", Icon: Gauge },
    ],
    scoped: true,
  },
  engineer: {
    label: "Field engineer",
    icon: Wrench,
    tone: "warning",
    tile: "orange",
    blurb: "Everything a viewer sees, and files maintenance reports with photos from site.",
    opens: [
      { label: "Dashboard", Icon: LayoutDashboard },
      { label: "Overview", Icon: Gauge },
      { label: "Maintenance", Icon: Wrench },
    ],
    scoped: true,
  },
  admin: {
    label: "Administrator",
    icon: Shield,
    tone: "brand",
    tile: "violet",
    blurb: "Every village, every setting, every voucher — and these accounts.",
    opens: [{ label: "Everything", Icon: Globe2 }],
    scoped: false,
  },
};

// Least privilege first, so the picker reads as a ladder rather than a menu.
const ROLE_ORDER = ["viewer", "engineer", "admin"];

function roleOf(role) {
  return (
    ROLES[role] || {
      label: role || "—",
      icon: Users,
      tone: "neutral",
      tile: "slate",
      blurb: "",
      opens: [],
      scoped: true,
    }
  );
}

function RolePill({ role }) {
  const r = roleOf(role);
  const Icon = r.icon;
  return (
    <StatusPill tone={r.tone} dot={false}>
      <Icon size={11} />
      {r.label}
    </StatusPill>
  );
}

/** What the server says about an account's state, turned into a badge. */
function StatusCell({ user }) {
  if (user.status === "invited") {
    return (
      <span className="inline-flex flex-col gap-1">
        <StatusPill tone="info" dot={false}>
          <Mail size={11} />
          Invited
        </StatusPill>
        <span className="text-[11px] text-[var(--fg-subtle)]">
          {user.inviteExpiresAt
            ? `Expires ${new Date(user.inviteExpiresAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`
            : "Waiting"}
        </span>
      </span>
    );
  }
  if (user.status === "invite-expired") {
    return (
      <StatusPill tone="warning" dot={false}>
        <AlertTriangle size={11} />
        Invite expired
      </StatusPill>
    );
  }
  if (!user.lastLoginAt) {
    return (
      <StatusPill tone="neutral" dot={false}>
        <Clock size={11} />
        Never signed in
      </StatusPill>
    );
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <StatusPill tone="success" dot={false}>
        <Check size={11} />
        Active
      </StatusPill>
      <span className="text-[11px] text-[var(--fg-subtle)]">
        {new Date(user.lastLoginAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
      </span>
    </span>
  );
}

/* ============================================================================
   Page
   ========================================================================= */
export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  // { user, kind: "password" | "twofactor" | "onboarding" | "invite" }
  const [rescue, setRescue] = useState(null);
  const [rescueBusy, setRescueBusy] = useState(false);
  // Held after a reset so the temporary password stays on screen: SMTP can be
  // down or the address wrong, and an admin who cannot see what was set has no
  // way to hand it over by another route.
  const [rescueResult, setRescueResult] = useState(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const { email: currentEmail } = useAuth();

  async function loadUsers() {
    try {
      const { users } = await userApi.list();
      setUsers(users);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  /**
   * Runs one rescue action. Reports the mail separately from the change,
   * because the account has already been altered by the time SMTP is tried and
   * telling the admin "failed" would be a lie about the part that succeeded.
   */
  async function runRescue() {
    if (!rescue) return;
    const { user, kind } = rescue;
    setRescueBusy(true);
    try {
      const r =
        kind === "password" ? await userApi.resetPassword(user.id)
        : kind === "twofactor" ? await userApi.resetTwoFactor(user.id)
        : kind === "invite" ? await userApi.resendInvite(user.id)
        : await userApi.resendOnboarding(user.id);

      setRescue(null);
      const mailLine = r.emailed
        ? `An email has been sent to ${user.email}.`
        : `The email could NOT be sent${r.emailError ? ` (${r.emailError})` : ""} — pass this on another way.`;

      if (kind === "twofactor") {
        setRescueResult({
          title: "Two-factor reset",
          message: `${user.email} will be asked to set up two-factor again at their next sign-in. ${mailLine}`,
        });
      } else if (kind === "invite") {
        // Nothing to show and nothing to copy: the link is in the mail and
        // nowhere else, which is the entire point of sending one.
        if (r.emailed) {
          toast.success(`Invite sent to ${user.email} — good for ${r.expiresDays || 7} days`);
        } else {
          setRescueResult({
            title: "Invite not sent",
            message:
              `A new link was created for ${user.email} but the email did not go out` +
              `${r.emailError ? ` (${r.emailError})` : ""}.\n\n` +
              `The link exists only inside that email, so there is nothing to pass on by hand — ` +
              `fix SMTP under Settings and send it again, or set a password for them directly by editing the account.`,
          });
        }
      } else {
        setRescueResult({
          title: kind === "password" ? "Password reset" : "Welcome email sent",
          message: `Temporary password for ${user.email}:\n\n${r.tempPassword}\n\nThey will be asked to change it when they sign in. ${mailLine}`,
        });
      }
      await loadUsers();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRescueBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await userApi.remove(deleteTarget.id);
      toast.success("User deleted");
      setDeleteTarget(null);
      loadUsers();
    } catch (e) {
      toast.error(e.message);
    }
  }

  const counts = useMemo(() => {
    const c = { all: users.length, admin: 0, viewer: 0, engineer: 0 };
    for (const u of users) if (c[u.role] != null) c[u.role] += 1;
    return c;
  }, [users]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (!needle) return true;
      return (
        String(u.email || "").toLowerCase().includes(needle) ||
        String(u.name || "").toLowerCase().includes(needle)
      );
    });
  }, [users, query, roleFilter]);

  const filtered = query.trim() !== "" || roleFilter !== "all";
  const pending = users.filter((u) => u.status === "invited" || u.status === "invite-expired").length;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Access"
        title="User Management"
        subtitle={
          pending
            ? `${users.length.toLocaleString()} account${users.length !== 1 ? "s" : ""} · ${pending} waiting on an invite`
            : `${users.length.toLocaleString()} account${users.length !== 1 ? "s" : ""} with console access.`
        }
        icon={<Users size={22} />}
        tone="pink"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={loadUsers} iconLeft={<RefreshCw size={14} />}>
              Refresh
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowCreate(true)} iconLeft={<UserPlus size={14} />}>
              Add user
            </Button>
          </>
        }
      />

      <Toolbar>
        <Segmented
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "admin", label: "Admins", count: counts.admin },
            { value: "viewer", label: "Viewers", count: counts.viewer },
            { value: "engineer", label: "Engineers", count: counts.engineer },
          ]}
          value={roleFilter}
          onChange={setRoleFilter}
        />
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or email…"
          width="w-64"
        />
        {filtered && (
          <span className="ml-auto text-[12px] text-[var(--fg-muted)] tabular-nums">
            {shown.length} of {users.length}
          </span>
        )}
      </Toolbar>

      {loading ? (
        <Panel padding>
          <SkeletonTable rows={5} cols={5} />
        </Panel>
      ) : users.length === 0 ? (
        <Panel padding={false}>
          <EmptyState
            icon={Users}
            title="No users found"
            description="Add a teammate to give them console access."
            action={
              <Button variant="primary" size="sm" onClick={() => setShowCreate(true)} iconLeft={<UserPlus size={14} />}>
                Add user
              </Button>
            }
          />
        </Panel>
      ) : (
        <Panel
          padding={false}
          title="Accounts"
          subtitle="Role decides which tabs a person finds; viewers and engineers are additionally limited to named villages."
          icon={<Users size={15} />}
          tone="pink"
        >
          <DataTable>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Villages</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <TableMessage colSpan={5}>No account matches those filters.</TableMessage>
              ) : (
                shown.map((u) => {
                  const r = roleOf(u.role);
                  const villages = Array.isArray(u.villageIds) ? u.villageIds.length : 0;
                  const isSelf = u.email === currentEmail;
                  const awaiting = u.status === "invited" || u.status === "invite-expired";
                  return (
                    <tr key={u.id}>
                      <Td>
                        <RecordCell
                          tone={r.tile}
                          icon={<span className="text-[12px] font-bold uppercase">{(u.name || u.email || "?").charAt(0)}</span>}
                          title={u.name || u.email}
                          subtitle={u.name ? u.email : undefined}
                        />
                      </Td>
                      <Td><RolePill role={u.role} /></Td>
                      <Td muted nowrap>
                        <span className="inline-flex items-center gap-1.5">
                          {r.scoped ? (
                            <>
                              <MapPin size={12} className="shrink-0" />
                              {villages === 0 ? (
                                <span className="text-[var(--warning-fg)] font-medium">No villages</span>
                              ) : (
                                `${villages} village${villages === 1 ? "" : "s"}`
                              )}
                            </>
                          ) : (
                            <>
                              <Globe2 size={12} className="shrink-0" />
                              Every village
                            </>
                          )}
                        </span>
                      </Td>
                      <Td><StatusCell user={u} /></Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-1">
                          <IconButton onClick={() => setEditTarget(u)} size="sm" title="Edit user" aria-label={`Edit ${u.email}`}>
                            <Edit3 size={14} />
                          </IconButton>

                          {/* An account still waiting on its invite gets ONE
                              obvious action — send it again. The password and
                              onboarding resets below would work, but both mail
                              a temporary password, which is the thing the
                              invite flow exists to avoid. */}
                          {awaiting && (
                            <IconButton
                              onClick={() => setRescue({ user: u, kind: "invite" })}
                              size="sm"
                              title="Send the invite link again"
                              aria-label={`Resend invite to ${u.email}`}
                              className="text-[var(--info-fg)] hover:bg-[var(--info-soft)]"
                            >
                              <MailCheck size={14} />
                            </IconButton>
                          )}

                          {/* The rescue actions. Each is confirmed first: all
                              invalidate something the account is using right
                              now, and a mis-click should not be the thing that
                              locks someone out on a Friday. */}
                          <IconButton
                            onClick={() => setRescue({ user: u, kind: "password" })}
                            size="sm"
                            title="Reset password and email a temporary one"
                            aria-label={`Reset password for ${u.email}`}
                          >
                            <KeyRound size={14} />
                          </IconButton>
                          <IconButton
                            onClick={() => setRescue({ user: u, kind: "twofactor" })}
                            size="sm"
                            title="Reset two-factor — for a lost or replaced phone"
                            aria-label={`Reset two-factor for ${u.email}`}
                          >
                            <ShieldOff size={14} />
                          </IconButton>
                          <IconButton
                            onClick={() => setRescue({ user: u, kind: "onboarding" })}
                            size="sm"
                            title="Resend the welcome email with a new temporary password"
                            aria-label={`Resend onboarding for ${u.email}`}
                          >
                            <Send size={14} />
                          </IconButton>

                          {/* You cannot delete yourself — the API refuses it, so
                              the row says why rather than offering the button. */}
                          {isSelf ? (
                            <span className="px-2 text-[11.5px] italic text-[var(--fg-subtle)]">you</span>
                          ) : (
                            <IconButton
                              onClick={() => setDeleteTarget(u)}
                              size="sm"
                              title="Delete user"
                              aria-label={`Delete ${u.email}`}
                              className="hover:text-[var(--brand)] hover:bg-[var(--brand-soft)]"
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </DataTable>
        </Panel>
      )}

      {/* ----- Modals ----- */}
      {showCreate && (
        <UserFormModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={(result) => {
            setShowCreate(false);
            if (result?.warn) setRescueResult(result.warn);
            loadUsers();
          }}
        />
      )}

      {editTarget && (
        <UserFormModal
          mode="edit"
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            loadUsers();
          }}
        />
      )}

      {/* One dialog for all of them: they differ in wording and endpoint, not in
          shape, and four near-identical dialogs drift apart. */}
      <ConfirmDialog
        open={!!rescue}
        title={RESCUE_COPY[rescue?.kind]?.title || ""}
        message={(RESCUE_COPY[rescue?.kind]?.message || "").replace("{email}", rescue?.user?.email || "")}
        confirmLabel={RESCUE_COPY[rescue?.kind]?.verb || "Confirm"}
        variant={rescue?.kind === "invite" ? "primary" : "danger"}
        loading={rescueBusy}
        onConfirm={runRescue}
        onCancel={() => setRescue(null)}
      />

      {/* Kept on screen until dismissed. Shown even when the email went,
          because "it was emailed" is not the same as "it arrived" and this is
          the only other copy that exists. */}
      {rescueResult && (
        <ConfirmDialog
          open
          title={rescueResult.title}
          message={rescueResult.message}
          confirmLabel="Done"
          onConfirm={() => setRescueResult(null)}
          onCancel={() => setRescueResult(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete user"
        message={`Remove ${deleteTarget?.email}? They will lose access immediately.`}
        confirmLabel="Delete user"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageShell>
  );
}

const RESCUE_COPY = {
  password: {
    title: "Reset password",
    verb: "Reset password",
    message:
      "A new temporary password will be set and emailed to {email}. Their current password stops working immediately, and they will be asked to choose a new one when they sign in.",
  },
  twofactor: {
    title: "Reset two-factor",
    verb: "Reset two-factor",
    message:
      "This clears the authenticator and every backup code for {email} — for a lost or replaced phone. They will set two-factor up again at their next sign-in, and will be emailed to say it happened.",
  },
  onboarding: {
    title: "Resend welcome email",
    verb: "Send welcome email",
    message:
      "A new temporary password will be set and the welcome email sent again to {email}. Any password they already have stops working.",
  },
  invite: {
    title: "Send the invite again",
    verb: "Send invite",
    message:
      "A fresh link will be emailed to {email} so they can choose their own password. Any earlier link stops working straight away.",
  },
};

/* ============================================================================
   One row of a joined field block.
   The label sits inside the row, above the value, so the row is a single
   target and a focused field has a whole surface to tint rather than a 1px
   border to thicken. Same treatment as the sign-in screen, deliberately — this
   and that are the two places the console asks for credentials.
   ========================================================================= */
function FormRow({ icon: Icon, label, hint, trailing, focused, children }) {
  return (
    <div className={"relative flex items-stretch transition-colors duration-150 " + (focused ? "bg-[var(--brand-soft)]" : "")}>
      <span
        aria-hidden
        className="absolute bottom-0 left-0 top-0 w-[2.5px] origin-center bg-[var(--brand)] transition-transform duration-150"
        style={{ transform: focused ? "scaleY(1)" : "scaleY(0)" }}
      />
      <span
        className={
          "flex w-[52px] shrink-0 items-center justify-center border-r transition-colors duration-150 " +
          (focused
            ? "border-[var(--brand-soft-hover)] text-[var(--brand)]"
            : "border-[var(--border-default)] text-[var(--fg-subtle)]")
        }
      >
        <Icon size={16} strokeWidth={1.9} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center px-4 py-2.5">
        <span className="mb-1.5 flex items-baseline gap-2 text-[9.5px] font-bold uppercase leading-none tracking-[0.14em] text-[var(--fg-muted)]">
          {label}
          {hint && <span className="font-medium normal-case tracking-normal text-[10.5px] text-[var(--fg-subtle)]">{hint}</span>}
        </span>
        {children}
      </span>
      {trailing && <span className="flex items-center gap-0.5 pr-2.5">{trailing}</span>}
    </div>
  );
}

const rowInput =
  "w-full border-0 bg-transparent p-0 text-[14px] leading-[1.35] " +
  "text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-subtle)]";

/* ============================================================================
   User form modal — create (two steps) OR edit (one form)
   ------------------------------------------------------------------------
   Create is two steps because the second one depends on the first: which
   villages to offer, and whether to offer them at all, is not knowable until
   the role is chosen. Putting both on one screen means a village picker that
   appears and disappears under the cursor, and a password field that is asked
   for before anyone has said who this person is.

   Edit is one screen. The role is already chosen, nothing is revealed by
   anything else, and an admin fixing a typo in a name should not be walked
   through a wizard to do it.
   ========================================================================= */
function UserFormModal({ mode, user, onClose, onSaved }) {
  const isEdit = mode === "edit";
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    email: user?.email || "",
    name: user?.name || "",
    role: user?.role || "viewer",
    villageIds: Array.isArray(user?.villageIds) ? user.villageIds : [],
    // The default is the one where nobody but the account holder ever knows
    // the password. Ticking the box is the deliberate exception.
    setPasswordDirectly: false,
    password: "",
  });
  const [villages, setVillages] = useState([]);
  const [villageQuery, setVillageQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focusField, setFocusField] = useState(null);

  useEffect(() => {
    networkApi.projects().then((d) => setVillages(d.projects || [])).catch(() => {});
  }, []);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const role = roleOf(form.role);
  const scoped = role.scoped;

  const shownVillages = useMemo(() => {
    const needle = villageQuery.trim().toLowerCase();
    if (!needle) return villages;
    return villages.filter(
      (v) =>
        String(v.name || "").toLowerCase().includes(needle) ||
        String(v.hostname || "").toLowerCase().includes(needle)
    );
  }, [villages, villageQuery]);

  function toggleVillage(id) {
    setForm((prev) => ({
      ...prev,
      villageIds: prev.villageIds.includes(id)
        ? prev.villageIds.filter((x) => x !== id)
        : [...prev.villageIds, id],
    }));
  }

  // Select-all acts on what is VISIBLE, which is the only reading that makes
  // sense next to a search box — "all" while filtered to three villages
  // meaning all twenty-nine would be a trap.
  function selectAllShown() {
    setForm((prev) => ({
      ...prev,
      villageIds: [...new Set([...prev.villageIds, ...shownVillages.map((v) => v.id)])],
    }));
  }
  function clearShown() {
    const ids = new Set(shownVillages.map((v) => v.id));
    setForm((prev) => ({ ...prev, villageIds: prev.villageIds.filter((x) => !ids.has(x)) }));
  }

  const emailOk = /\S+@\S+\.\S+/.test(form.email);
  const step1Ok = emailOk;
  const scopeOk = !scoped || form.villageIds.length > 0;
  const passwordOk = !form.setPasswordDirectly || form.password.length >= 6;

  async function handleSubmit(e) {
    e?.preventDefault();
    setErr("");
    if (!scopeOk) {
      setErr(`Choose at least one village — a ${role.label.toLowerCase()} with none signs in to an empty console.`);
      return;
    }
    if (!passwordOk) {
      setErr("A password you set must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      if (isEdit) {
        const body = {};
        if (form.name !== (user.name || "")) body.name = form.name;
        if (form.email !== user.email) body.email = form.email;
        if (form.role !== user.role) body.role = form.role;
        if (form.setPasswordDirectly && form.password) body.password = form.password;
        // Send the village set whenever this is (or becomes) a scoped role so
        // the backend replaces it; for admins the backend clears it itself.
        if (scoped) body.villageIds = form.villageIds;
        if (Object.keys(body).length === 0) {
          setErr("Nothing has changed.");
          setLoading(false);
          return;
        }
        await userApi.update(user.id, body);
        toast.success("Account updated");
        onSaved();
        return;
      }

      const r = await userApi.create({
        email: form.email,
        name: form.name,
        role: form.role,
        villageIds: scoped ? form.villageIds : [],
        // Omitted entirely on the invite path — the server reads its absence
        // as "mint an invite", not as an empty password.
        ...(form.setPasswordDirectly ? { password: form.password } : {}),
      });

      if (!r.invited) {
        toast.success(`${form.email} can sign in now`);
        onSaved();
        return;
      }
      if (r.emailed) {
        toast.success(`Invite sent to ${form.email} — good for ${r.expiresDays || 7} days`);
        onSaved();
        return;
      }
      // The account exists but the link went nowhere. Said loudly, because the
      // list will show a perfectly normal-looking "Invited" row either way.
      onSaved({
        warn: {
          title: "Account created — invite not sent",
          message:
            `${form.email} was created, but the invite email did not go out` +
            `${r.emailError ? ` (${r.emailError})` : ""}.\n\n` +
            `The link exists only inside that email, so there is nothing to pass on by hand. ` +
            `Fix SMTP under Settings and use the resend button on their row, or edit the account and set a password directly.`,
        },
      });
    } catch (e) {
      setErr(e.message);
      setLoading(false);
    }
  }

  /* ---------------------------------------------------------------- pieces */

  const identityBlock = (
    <div
      className={
        "overflow-hidden rounded-2xl border bg-[var(--surface)] transition-shadow duration-150 " +
        (focusField
          ? "border-[var(--brand)] shadow-[0_0_0_4px_var(--brand-soft)]"
          : "border-[var(--input-border)] shadow-[var(--shadow-xs)]")
      }
    >
      <FormRow icon={UserIcon} label="Name" hint="optional" focused={focusField === "name"}>
        <input
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          onFocus={() => setFocusField("name")}
          onBlur={() => setFocusField(null)}
          placeholder="Full name"
          autoComplete="off"
          className={rowInput}
        />
      </FormRow>
      <div className="h-px bg-[var(--border-default)]" />
      <FormRow icon={Mail} label="Email" focused={focusField === "email"}>
        <input
          type="email"
          value={form.email}
          onChange={(e) => setField("email", e.target.value)}
          onFocus={() => setFocusField("email")}
          onBlur={() => setFocusField(null)}
          placeholder="name@vodafone.com.fj"
          required
          autoComplete="off"
          autoFocus={!isEdit}
          className={rowInput}
        />
      </FormRow>
    </div>
  );

  const rolePicker = (
    <div className="flex flex-col gap-2.5">
      {ROLE_ORDER.map((value) => {
        const opt = ROLES[value];
        const selected = form.role === value;
        const Icon = opt.icon;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setField("role", value)}
            aria-pressed={selected}
            className={
              "flex items-start gap-3.5 rounded-2xl border p-4 text-left transition-all duration-150 " +
              (selected
                ? "border-[var(--brand)] bg-[var(--brand-soft)] shadow-[0_0_0_3px_var(--brand-soft)]"
                : "border-[var(--border-default)] bg-[var(--surface-raised)] hover:border-[var(--border-hover)] hover:bg-[var(--surface-hover)]")
            }
          >
            <span
              className={
                "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[11px] " +
                (selected
                  ? "bg-[var(--brand)] text-[var(--text-on-brand)]"
                  : "border border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[var(--fg-muted)]")
              }
            >
              <Icon size={15} />
            </span>
            <span className="flex min-w-0 flex-col gap-2">
              <span className="flex flex-col gap-0.5">
                <span
                  className={
                    "font-display text-[13.5px] font-bold " +
                    (selected ? "text-[var(--brand-fg-on-soft)]" : "text-[var(--fg-primary)]")
                  }
                >
                  {opt.label}
                </span>
                <span className="text-[12px] leading-snug text-[var(--fg-muted)]">{opt.blurb}</span>
              </span>
              {/* The tabs they will actually find. This is the part an admin is
                  really choosing between. */}
              <span className="flex flex-wrap items-center gap-1.5">
                {opt.opens.map(({ label, Icon: TabIcon }) => (
                  <span
                    key={label}
                    className={
                      "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium " +
                      (selected
                        ? "bg-[var(--surface)] text-[var(--fg-secondary)]"
                        : "bg-[var(--bg-surface)] text-[var(--fg-muted)]")
                    }
                  >
                    <TabIcon size={10} />
                    {label}
                  </span>
                ))}
                {opt.scoped && (
                  <span className="text-[10.5px] text-[var(--fg-subtle)]">· for chosen villages only</span>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );

  const villagePicker = scoped && (
    <Field
      label="Villages this account may see"
      required
      hint="Enforced on the server — the dashboard and overview answer with these villages and no others."
    >
      {villages.length === 0 ? (
        <p className="text-[12.5px] text-[var(--fg-muted)]">No villages yet — add them under Network first.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border-default)]">
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-2">
            <Search size={13} className="shrink-0 text-[var(--fg-subtle)]" />
            <input
              value={villageQuery}
              onChange={(e) => setVillageQuery(e.target.value)}
              placeholder="Filter villages…"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[12.5px] text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-subtle)]"
            />
            <button
              type="button"
              onClick={selectAllShown}
              className="rounded px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--brand-fg-on-soft)] hover:bg-[var(--brand-soft)]"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={clearShown}
              className="rounded px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--fg-muted)] hover:bg-[var(--surface-hover)]"
            >
              Clear
            </button>
          </div>

          <div className="max-h-56 divide-y divide-[var(--border-subtle)] overflow-y-auto">
            {shownVillages.length === 0 ? (
              <p className="px-3.5 py-4 text-[12.5px] text-[var(--fg-muted)]">Nothing matches “{villageQuery}”.</p>
            ) : (
              shownVillages.map((v) => {
                const checked = form.villageIds.includes(v.id);
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => toggleVillage(v.id)}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
                  >
                    <span
                      className={
                        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors " +
                        (checked
                          ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--text-on-brand)]"
                          : "border-[var(--border-strong)] text-transparent")
                      }
                    >
                      <Check size={12} strokeWidth={3} />
                    </span>
                    <MapPin size={14} className="shrink-0 text-[var(--fg-subtle)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-[var(--fg-primary)]">{v.name}</span>
                      {v.hostname && (
                        <span className="block truncate font-mono text-[11px] text-[var(--fg-muted)]">{v.hostname}</span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2">
            <span className="text-[11.5px] tabular-nums text-[var(--fg-muted)]">
              {form.villageIds.length} of {villages.length} selected
            </span>
            {form.villageIds.length === 0 && (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--warning-fg)]">
                <AlertTriangle size={12} />
                Pick at least one
              </span>
            )}
          </div>
        </div>
      )}
    </Field>
  );

  const signInSection = (
    <Field label={isEdit ? "Password" : "How they get in"}>
      <div className="flex flex-col gap-3">
        {!isEdit && !form.setPasswordDirectly && (
          <div className="flex items-start gap-3 rounded-xl border border-[var(--info-border)] bg-[var(--info-soft)] px-4 py-3">
            <MailCheck size={16} className="mt-0.5 shrink-0 text-[var(--info-fg)]" />
            <p className="text-[12.5px] leading-relaxed text-[var(--info-fg)]">
              We’ll email{" "}
              <span className="font-semibold">{form.email || "them"}</span> a link to choose their own
              password. It works once, expires in seven days, and nobody here — including you — ever
              sees what they pick.
            </p>
          </div>
        )}

        <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-[var(--fg-secondary)]">
          <input
            type="checkbox"
            checked={form.setPasswordDirectly}
            onChange={(e) => {
              setField("setPasswordDirectly", e.target.checked);
              if (e.target.checked && !form.password) setField("password", generatePassword());
              setShowPassword(e.target.checked);
            }}
            className="mt-0.5 cursor-pointer accent-[var(--brand)]"
          />
          <span>
            <span className="font-medium text-[var(--fg-primary)]">
              {isEdit ? "Set a new password for them" : "Set the password myself instead"}
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
              {isEdit
                ? "Replaces whatever they have now. They will be asked to change it at their next sign-in."
                : "For someone with no mailbox yet, or standing next to you. They will be asked to change it at first sign-in."}
            </span>
          </span>
        </label>

        {form.setPasswordDirectly && (
          <div className="overflow-hidden rounded-2xl border border-[var(--input-border)] bg-[var(--surface)] shadow-[var(--shadow-xs)]">
            <FormRow
              icon={KeyRound}
              label="Password"
              hint="min 6 characters"
              focused={focusField === "password"}
              trailing={
                <>
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="rounded-lg p-1.5 text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)]"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(form.password).then(
                        () => toast.success("Password copied"),
                        () => toast.error("Could not copy — select it by hand")
                      );
                    }}
                    tabIndex={-1}
                    aria-label="Copy password"
                    title="Copy"
                    className="rounded-lg p-1.5 text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)]"
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setField("password", generatePassword()); setShowPassword(true); }}
                    tabIndex={-1}
                    aria-label="Generate a password"
                    title="Generate"
                    className="rounded-lg p-1.5 text-[var(--fg-muted)] transition-colors hover:bg-[var(--brand-soft)] hover:text-[var(--brand)]"
                  >
                    <Dices size={15} />
                  </button>
                </>
              }
            >
              <input
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(e) => setField("password", e.target.value)}
                onFocus={() => setFocusField("password")}
                onBlur={() => setFocusField(null)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                className={`${rowInput} ${showPassword ? "font-mono tracking-[0.04em]" : ""}`}
              />
            </FormRow>
          </div>
        )}

        {form.setPasswordDirectly && (
          <p className="text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
            You will need to pass this on yourself — it is not emailed. Anything you send it over is
            somewhere it will still be readable next year.
          </p>
        )}
      </div>
    </Field>
  );

  const errorBox = err && (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3.5 py-3"
    >
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--danger-fg)]" />
      <p className="text-[12.5px] font-medium leading-relaxed text-[var(--danger-fg)]">{err}</p>
    </div>
  );

  /* ------------------------------------------------------------------ edit */

  if (isEdit) {
    return (
      <Modal open onClose={onClose} width="lg">
        <Modal.Header
          eyebrow={user?.email}
          title="Edit account"
          subtitle="Role decides which tabs they find; villages decide what the numbers on them add up to."
          icon={Edit3}
          onClose={onClose}
        />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <Modal.Body>
            <div className="flex flex-col gap-6">
              {identityBlock}
              <Field label="Role" required>{rolePicker}</Field>
              {villagePicker}
              {signInSection}
              {errorBox}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button type="submit" variant="primary" loading={loading}>Save changes</Button>
          </Modal.Footer>
        </form>
      </Modal>
    );
  }

  /* ---------------------------------------------------------------- create */

  return (
    <Modal open onClose={onClose} width="lg">
      <Modal.Header
        eyebrow={`Step ${step} of 2`}
        title={step === 1 ? "Who is this for?" : "What they can see, and how they get in"}
        subtitle={
          step === 1
            ? "The role decides which tabs they find when they sign in."
            : `Setting up ${form.name || form.email}.`
        }
        icon={step === 1 ? UserPlus : Check}
        onClose={onClose}
      />

      {/* Two segments rather than numbered circles: the point is how much is
          left, and a bar answers that without being read. */}
      <div className="flex gap-1.5 px-7 pt-5">
        {[1, 2].map((n) => (
          <span
            key={n}
            className={
              "h-[3px] flex-1 rounded-full transition-colors duration-200 " +
              (n <= step ? "bg-[var(--brand)]" : "bg-[var(--surface-pressed)]")
            }
          />
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (step === 1) setStep(2); else handleSubmit(e); }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <Modal.Body className="!pt-5">
          {step === 1 ? (
            <div className="flex flex-col gap-6">
              {identityBlock}
              <Field label="Role" required>{rolePicker}</Field>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {villagePicker}
              {!scoped && (
                <div className="flex items-start gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
                  <Globe2 size={16} className="mt-0.5 shrink-0 text-[var(--fg-muted)]" />
                  <p className="text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
                    Administrators are not limited to villages — this account will see the whole
                    estate, and will be able to change these accounts too.
                  </p>
                </div>
              )}
              {signInSection}
              {errorBox}
            </div>
          )}
        </Modal.Body>

        <Modal.Footer>
          {step === 1 ? (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={!step1Ok} iconRight={<ArrowRight size={15} />}>
                Continue
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => { setStep(1); setErr(""); }} iconLeft={<ArrowLeft size={15} />}>
                Back
              </Button>
              <Button type="submit" variant="primary" loading={loading}>
                {form.setPasswordDirectly ? "Create account" : "Create and send invite"}
              </Button>
            </>
          )}
        </Modal.Footer>
      </form>
    </Modal>
  );
}
