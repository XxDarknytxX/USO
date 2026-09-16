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
  ShieldOff, Send, Check, Wrench, Globe2, Mail, User as UserIcon,
  MailCheck, AlertTriangle, Copy, Clock,
  LayoutDashboard, Gauge, Dices, Receipt,
} from "lucide-react";

import { userApi } from "../services/api";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useSite } from "../hooks/useSite";
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
    blurb: "Reads the numbers and the maintenance record. Changes nothing, anywhere.",
    opens: [
      { label: "Dashboard", Icon: LayoutDashboard },
      { label: "Overview", Icon: Gauge },
      { label: "Maintenance (view)", Icon: Wrench },
    ],
    scoped: true,
  },
  engineer: {
    label: "Field engineer",
    icon: Wrench,
    tone: "warning",
    tile: "orange",
    blurb: "Files maintenance reports with photos from site. Sees no dashboard, figures or vouchers.",
    opens: [{ label: "Maintenance", Icon: Wrench }],
    scoped: true,
  },
  billing: {
    label: "Billing",
    icon: Receipt,
    tone: "success",
    tile: "green",
    blurb: "Reads the monthly bill and the numbers behind it. Changes nothing, including the target.",
    opens: [
      { label: "Dashboard", Icon: LayoutDashboard },
      { label: "Overview", Icon: Gauge },
      { label: "Billing", Icon: Receipt },
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
const ROLE_ORDER = ["viewer", "engineer", "billing", "admin"];

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
/** "until 3:40 pm" today, or "until 17 Sep, 9:10 am" if it runs past midnight. */
function linkExpiry(at) {
  if (!at) return "Waiting";
  const d = new Date(at);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  return sameDay
    ? `until ${time}`
    : `until ${d.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}, ${time}`;
}

/*
 * Every status is exactly TWO lines — a pill, and one line under it (blank when
 * there is nothing to say) — so every row in the table is the same height.
 * A third line for "link out until …" made one row taller than its neighbours,
 * and the pill column stretched the pill to the width of that line.
 *
 * A live password link on an account that can still sign in is shown as a
 * small mail mark INSIDE the pill row, with the expiry in its tooltip, rather
 * than as another line of text.
 */
function StatusLine({ children }) {
  return (
    <span className="block h-[15px] truncate text-[11px] leading-[15px] text-[var(--fg-subtle)]">
      {children}
    </span>
  );
}

function LinkMark({ at }) {
  const label = `Password link out ${linkExpiry(at)}`;
  return (
    <span
      title={label}
      aria-label={label}
      className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[var(--info-soft)] text-[var(--info-fg)]"
    >
      <Mail size={10} />
    </span>
  );
}

function StatusCell({ user }) {
  // A link that lives for hours needs its time shown, not its date.
  const pending = {
    invited:          { label: "Invited",        tone: "info",    Icon: Mail,          live: true },
    "invite-expired": { label: "Invite expired", tone: "warning", Icon: AlertTriangle, live: false },
    "reset-sent":     { label: "Reset sent",     tone: "info",    Icon: KeyRound,      live: true },
    // The old password was retired when this link went out, so the account is
    // locked until someone sends another. The loudest tone the table has.
    "reset-expired":  { label: "Locked",         tone: "danger",  Icon: AlertTriangle, live: false },
  }[user.status];

  let pill, line;
  if (pending) {
    pill = (
      <StatusPill tone={pending.tone} dot={false}>
        <pending.Icon size={11} />
        {pending.label}
      </StatusPill>
    );
    line = pending.live
      ? linkExpiry(user.inviteExpiresAt)
      : user.status === "reset-expired" ? "reset link expired" : "send the link again";
  } else if (!user.lastLoginAt) {
    pill = (
      <StatusPill tone="neutral" dot={false}>
        <Clock size={11} />
        Never signed in
      </StatusPill>
    );
    line = "";
  } else {
    pill = (
      <StatusPill tone="success" dot={false}>
        <Check size={11} />
        Active
      </StatusPill>
    );
    line = new Date(user.lastLoginAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    // items-start: the pill keeps its own width instead of stretching to the
    // widest line beneath it.
    <span className="inline-flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-1.5">
        {pill}
        {!pending && user.linkLive && <LinkMark at={user.inviteExpiresAt} />}
      </span>
      <StatusLine>{line}</StatusLine>
    </span>
  );
}

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
  // The server's configured link lifetimes, so every sentence states the real
  // number instead of "a couple of hours" beside a value somebody configured.
  const [linkHours, setLinkHours] = useState({ invite: 8, reset: 2 });
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const { email: currentEmail } = useAuth();

  async function loadUsers() {
    try {
      const { users, linkHours: hours } = await userApi.list();
      setUsers(users);
      if (hours) setLinkHours(hours);
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
   * Runs one rescue action and reports what actually happened.
   *
   * Nothing here ever shows a password. Resets and onboarding both email a
   * one-time link, and the link exists only inside that email — so when the
   * email fails, the honest report is "nothing was sent, send it again", not a
   * credential for the admin to pass on by hand.
   */
  async function runRescue() {
    if (!rescue) return;
    const { user, kind } = rescue;
    setRescueBusy(true);
    try {
      const r =
        kind === "password" ? await userApi.resetPassword(user.id)
        : kind === "twofactor" ? await userApi.resetTwoFactor(user.id)
        : await userApi.resendOnboarding(user.id);

      setRescue(null);

      if (kind === "twofactor") {
        setRescueResult({
          title: "Two-factor reset",
          message:
            `${user.email} will be asked to set up two-factor again at their next sign-in. ` +
            (r.emailed
              ? "They have been emailed to say it happened."
              : `The notification email could NOT be sent${r.emailError ? ` (${r.emailError})` : ""}, so tell them another way.`),
        });
      } else if (r.emailed) {
        const hours = r.expiresHours;
        const valid = `valid ${hours} hour${hours === 1 ? "" : "s"}`;
        toast.success(
          kind !== "password"
            ? `Onboarding link sent to ${user.email} — ${valid}.`
            : r.retired
              ? `Reset link sent to ${user.email} — ${valid}. Their old password no longer works.`
              // Said plainly, because the admin clicked "reset" expecting the
              // old password to die. It did not, and they need to know that.
              : `Reset link sent to ${user.email} — ${valid}. Their password was changed moments ago, so it was left as it is.`,
          { duration: 8000 }
        );
      } else {
        setRescueResult({
          title: kind === "password" ? "Reset link not sent" : "Onboarding link not sent",
          message:
            `The email to ${user.email} could not be sent${r.emailError ? ` (${r.emailError})` : ""}.\n\n` +
            (kind === "password"
              ? "Nothing was changed: their current password still works, and no link exists. "
              : "No link exists, and any earlier one has stopped working. ") +
            "Fix email under Settings and try again — or edit the account and set a password for them directly.",
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
    const c = { all: users.length, admin: 0, viewer: 0, engineer: 0, billing: 0 };
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
  const pending = users.filter((u) => u.status !== "active").length;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Access"
        title="User Management"
        subtitle={
          pending
            ? `${users.length.toLocaleString()} account${users.length !== 1 ? "s" : ""} · ${pending} waiting on a password link`
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
            { value: "billing", label: "Billing", count: counts.billing },
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
          subtitle="Role decides which tabs a person finds. Which villages they see is the estate default, set once under Settings."
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
                  const isSelf = u.email === currentEmail;
                  // Waiting on a link — onboarding or reset, live or lapsed.
                  const awaiting = u.status !== "active";
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
                          {!r.scoped ? (
                            <>
                              <Globe2 size={12} className="shrink-0" />
                              Every village
                            </>
                          ) : (
                            // Every scoped account sees the same thing: the
                            // estate default. There is nothing per-account to
                            // report here, and a number would imply otherwise.
                            <>
                              <Globe2 size={12} className="shrink-0" />
                              Estate default
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

                          {/* The rescue actions. Each is confirmed first: all
                              invalidate something the account is using right
                              now, and a mis-click should not be the thing that
                              locks someone out on a Friday.

                              Neither reset is offered on your own row. The
                              server refuses both — a password reset retires
                              your password before you know the email arrived,
                              and a 2FA reset would go round the password check —
                              and a button whose only outcome is an error is
                              worse than no button. Profile → Security does both
                              for your own account. */}
                          {!isSelf && (
                            <IconButton
                              onClick={() => setRescue({ user: u, kind: "password" })}
                              size="sm"
                              title="Reset password — emails a one-time link, and the old password stops working"
                              aria-label={`Reset password for ${u.email}`}
                            >
                              <KeyRound size={14} />
                            </IconButton>
                          )}
                          {!isSelf && (
                            <IconButton
                              onClick={() => setRescue({ user: u, kind: "twofactor" })}
                              size="sm"
                              title="Reset two-factor — for a lost or replaced phone"
                              aria-label={`Reset two-factor for ${u.email}`}
                            >
                              <ShieldOff size={14} />
                            </IconButton>
                          )}
                          <IconButton
                            onClick={() => setRescue({ user: u, kind: awaiting && u.status.startsWith("reset") ? "password" : "onboarding" })}
                            size="sm"
                            title={
                              awaiting
                                ? "Send the link again — the earlier one stops working"
                                : "Send an onboarding link to set a password"
                            }
                            aria-label={`Send a password link to ${u.email}`}
                            className={awaiting ? "text-[var(--info-fg)] hover:bg-[var(--info-soft)]" : ""}
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
        message={(RESCUE_COPY[rescue?.kind]?.message || "")
          .replace("{email}", rescue?.user?.email || "")
          .replace("{resetHours}", `${linkHours.reset} hour${linkHours.reset === 1 ? "" : "s"}`)
          .replace("{inviteHours}", `${linkHours.invite} hour${linkHours.invite === 1 ? "" : "s"}`)}
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
    verb: "Send reset link",
    message:
      "A one-time link to choose a new password will be emailed to {email}. It works once and expires in {resetHours}. " +
      "Their current password stops working as soon as the email is sent — if the email cannot be sent, nothing changes.",
  },
  twofactor: {
    title: "Reset two-factor",
    verb: "Reset two-factor",
    message:
      "This clears the authenticator and every backup code for {email} — for a lost or replaced phone. They will set two-factor up again at their next sign-in, and will be emailed to say it happened.",
  },
  onboarding: {
    title: "Send onboarding link",
    verb: "Send link",
    message:
      "A one-time link to set their password will be emailed to {email}. It works once and expires in {inviteHours}, and any earlier link stops working. " +
      "A password they already have is left alone.",
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
  const [form, setForm] = useState({
    email: user?.email || "",
    name: user?.name || "",
    role: user?.role || "viewer",
    // The default is the one where nobody but the account holder ever knows
    // the password. Ticking the box is the deliberate exception.
    setPasswordDirectly: false,
    password: "",
  });
  // How many villages the estate default currently covers, so the choice can
  // say what "follow the default" actually means rather than making the admin
  // go and look. null there means no restriction — i.e. all of them.
  const { globalVisibleSiteIds } = useSite();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focusField, setFocusField] = useState(null);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const role = roleOf(form.role);
  const scoped = role.scoped;
  const estateCount = globalVisibleSiteIds == null ? null : globalVisibleSiteIds.length;

  const emailOk = /\S+@\S+\.\S+/.test(form.email);
  const passwordOk = !form.setPasswordDirectly || form.password.length >= 6;

  async function handleSubmit(e) {
    e?.preventDefault();
    setErr("");
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
        if (Object.keys(body).length === 0) {
          setErr("Nothing has changed.");
          setLoading(false);
          return;
        }
        const upd = await userApi.update(user.id, body);
        toast.success(
          upd?.linkCancelled
            ? "Account updated. The password link that was out has been cancelled — send a new one if they still need it."
            : "Account updated",
          { duration: upd?.linkCancelled ? 8000 : 4000 }
        );
        onSaved();
        return;
      }

      const r = await userApi.create({
        email: form.email,
        name: form.name,
        role: form.role,
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
        toast.success(`Onboarding link sent to ${form.email} — valid ${r.expiresHours} hour${r.expiresHours === 1 ? "" : "s"}`);
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
                  <span className="text-[10.5px] text-[var(--fg-subtle)]">· villages in the estate default</span>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );

  // What a scoped account sees is decided in ONE place: the estate default
  // under Settings. Not here, per account.
  //
  // There was a per-account picker. It was thirty-one checkboxes answering a
  // question the estate default had already answered, and the two copies would
  // have diverged the day a village was added — with nobody remembering which
  // accounts needed updating. Excluding a test village should be one decision
  // that takes effect everywhere, and now it is.
  const scopeNote = scoped && (
    <Field label="Villages this account may see">
      <div className="flex items-start gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
        <Globe2 size={16} className="mt-0.5 shrink-0 text-[var(--fg-muted)]" />
        <p className="text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
          {estateCount == null
            ? "Every village in the estate."
            : `The ${estateCount} village${estateCount === 1 ? "" : "s"} in the estate default.`}{" "}
          Set once under{" "}
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="font-medium text-[var(--brand-fg-on-soft)] underline underline-offset-2 hover:no-underline"
          >
            Settings → Estate default
          </button>
          , and every viewer, engineer and billing account follows it — so taking a test village out is one change, not
          one per account. Enforced on the server.
        </p>
      </div>
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
              password. It works once, expires within hours, and nobody here — including you — ever
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
          subtitle="Role decides which tabs they find. Which villages they see is the estate default."
          icon={Edit3}
          onClose={onClose}
        />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <Modal.Body>
            <div className="flex flex-col gap-6">
              {identityBlock}
              <Field label="Role" required>{rolePicker}</Field>
              {scopeNote}
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
  //
  // One screen. It was two while there was a village picker whose contents
  // depended on the role chosen above it — nothing is conditional on anything
  // now, and a wizard for four fields is ceremony.

  return (
    <Modal open onClose={onClose} width="lg">
      <Modal.Header
        eyebrow="New account"
        title="Add a teammate"
        subtitle="The role decides which tabs they find when they sign in."
        icon={UserPlus}
        onClose={onClose}
      />

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <Modal.Body>
          <div className="flex flex-col gap-6">
            {identityBlock}
            <Field label="Role" required>{rolePicker}</Field>
            {scopeNote}
            {!scoped && (
              <div className="flex items-start gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
                <Globe2 size={16} className="mt-0.5 shrink-0 text-[var(--fg-muted)]" />
                <p className="text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
                  Administrators are not limited to villages — this account will see the whole estate,
                  and will be able to change these accounts too.
                </p>
              </div>
            )}
            {signInSection}
            {errorBox}
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={loading} disabled={!emailOk}>
            {form.setPasswordDirectly ? "Create account" : "Create and send invite"}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}