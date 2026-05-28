// src/pages/UsersPage.jsx
// Admin user list + create/edit modal.

import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import {
  Users,
  UserPlus,
  Trash2,
  Shield,
  Eye,
  EyeOff,
  Edit3,
  RefreshCw,
} from "lucide-react";

import { userApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import ConfirmDialog from "../components/shared/ConfirmDialog";
import {
  Modal,
  Field,
  Input,
  Button,
  IconButton,
  Badge,
  EmptyState,
} from "../components/ui";

function generatePassword(len = 14) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let pw = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) pw += chars[arr[i] % chars.length];
  return pw;
}

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
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

  return (
    <div className="page-shell">
      {/* ----- Header ----- */}
      <div className="page-header">
        <div className="flex items-center gap-3 min-w-0">
          <span className="brand-mark">
            <Users size={15} />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="page-eyebrow">Access</span>
            <h1 className="page-title">User Management</h1>
            <p className="page-subtitle">
              {users.length.toLocaleString()} account{users.length !== 1 ? "s" : ""} with
              console access.
            </p>
          </div>
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={() => setShowCreate(true)}
          iconLeft={<UserPlus size={14} />}
        >
          Add user
        </Button>
      </div>

      {/* ----- Table ----- */}
      <div className="flex-1 min-h-0 px-8 py-5">
        <div
          className={
            "h-full flex flex-col rounded-lg " +
            "bg-[var(--surface-raised)] border border-[var(--border-default)] " +
            "shadow-[var(--elev-1)] overflow-hidden"
          }
        >
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 rounded skeleton" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No users found"
              description="Add a teammate to give them console access."
            />
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10">
                  <tr
                    className={
                      "bg-[var(--surface-sunken)] text-left " +
                      "text-[12px] font-medium text-[var(--text-tertiary)]"
                    }
                  >
                    <th className="px-5 py-2.5 font-medium">User</th>
                    <th className="px-5 py-2.5 font-medium">Role</th>
                    <th className="px-5 py-2.5 font-medium">Joined</th>
                    <th className="px-5 py-2.5 font-mono font-medium text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className="border-t border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] transition-colors"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={
                              "shrink-0 h-7 w-7 rounded-md flex items-center justify-center text-[11px] font-semibold uppercase " +
                              "bg-[var(--surface-sunken)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                            }
                          >
                            {(u.email || "?").charAt(0)}
                          </span>
                          <div className="flex flex-col min-w-0">
                            <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                              {u.name || "—"}
                            </span>
                            <span className="text-[11.5px] text-[var(--text-tertiary)] font-mono truncate">
                              {u.email}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={u.role === "admin" ? "brand" : "neutral"} icon={
                          u.role === "admin" ? <Shield size={10} /> : <Eye size={10} />
                        }>
                          {u.role}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-[12px] text-[var(--text-tertiary)] font-mono">
                        {new Date(u.created_at).toLocaleDateString("en-AU", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <IconButton
                            onClick={() => setEditTarget(u)}
                            size="sm"
                            title="Edit user"
                          >
                            <Edit3 size={14} />
                          </IconButton>
                          {u.email !== currentEmail ? (
                            <IconButton
                              onClick={() => setDeleteTarget(u)}
                              size="sm"
                              title="Delete user"
                              className="hover:text-[var(--brand)] hover:bg-[var(--brand-soft)]"
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          ) : (
                            <span className="text-[11px] text-[var(--text-quaternary)] italic px-2 font-mono">
                              you
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ----- Modals ----- */}
      {showCreate && (
        <UserFormModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
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

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete user"
        message={`Remove ${deleteTarget?.email}? They will lose access immediately.`}
        confirmLabel="Delete user"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/* ============================================================================
   User form modal — create OR edit
   ============================================================================ */
function UserFormModal({ mode, user, onClose, onSaved }) {
  const isEdit = mode === "edit";
  const [form, setForm] = useState({
    email: user?.email || "",
    password: "",
    name: user?.name || "",
    role: user?.role || "viewer",
  });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleGenPassword() {
    setField("password", generatePassword());
    setShowPassword(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      if (isEdit) {
        const body = {};
        if (form.name !== (user.name || "")) body.name = form.name;
        if (form.email !== user.email) body.email = form.email;
        if (form.role !== user.role) body.role = form.role;
        if (form.password) body.password = form.password;
        await userApi.update(user.id, body);
        toast.success("User updated");
      } else {
        await userApi.create(form);
        toast.success("User created");
      }
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} width="md">
      <Modal.Header
        eyebrow={isEdit ? "Edit user" : "New user"}
        title={isEdit ? "Edit user details" : "Add a teammate"}
        subtitle={
          isEdit
            ? "Update name, email, role or set a new password."
            : "Send the credentials privately — passwords aren't recoverable."
        }
        icon={isEdit ? Edit3 : UserPlus}
        onClose={onClose}
      />

      <form onSubmit={handleSubmit}>
        <Modal.Body>
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Name" htmlFor="u-name">
                <Input
                  id="u-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  placeholder="Full name"
                  autoComplete="name"
                />
              </Field>

              <Field label="Email" required htmlFor="u-email">
                <Input
                  id="u-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                  placeholder="user@example.com"
                  required
                  autoComplete="off"
                />
              </Field>
            </div>

            <Field
              label="Password"
              required={!isEdit}
              hint={
                isEdit
                  ? "Leave blank to keep the current password."
                  : "At least 6 characters. Use the dice to generate one."
              }
              htmlFor="u-password"
            >
              <div className="relative">
                <Input
                  id="u-password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setField("password", e.target.value)}
                  placeholder={isEdit ? "New password" : "Min 6 characters"}
                  required={!isEdit}
                  minLength={form.password ? 6 : undefined}
                  autoComplete="new-password"
                  mono={!!form.password && showPassword}
                  className="pr-20"
                />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide" : "Show"}
                    className="h-7 w-7 inline-flex items-center justify-center rounded text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-ring"
                  >
                    {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <button
                    type="button"
                    onClick={handleGenPassword}
                    tabIndex={-1}
                    title="Generate random password"
                    aria-label="Generate password"
                    className="h-7 w-7 inline-flex items-center justify-center rounded text-[var(--text-quaternary)] hover:text-[var(--brand)] hover:bg-[var(--brand-soft)] focus-ring"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
              </div>
            </Field>

            <Field label="Role" required>
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    value: "viewer",
                    label: "Viewer",
                    desc: "Read-only access",
                    icon: Eye,
                  },
                  {
                    value: "admin",
                    label: "Admin",
                    desc: "Full administrative access",
                    icon: Shield,
                  },
                ].map((opt) => {
                  const selected = form.role === opt.value;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setField("role", opt.value)}
                      className={
                        "flex items-start gap-3 text-left p-3 rounded-md border transition-colors " +
                        (selected
                          ? "border-[var(--brand)] bg-[var(--brand-soft)] shadow-[0_0_0_3px_var(--brand-soft)]"
                          : "border-[var(--border-default)] bg-[var(--surface-raised)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]")
                      }
                    >
                      <span
                        className={
                          "shrink-0 h-8 w-8 rounded-md flex items-center justify-center mt-0.5 " +
                          (selected
                            ? "bg-[var(--brand)] text-[var(--text-on-brand)]"
                            : "bg-[var(--surface-sunken)] text-[var(--text-tertiary)] border border-[var(--border-subtle)]")
                        }
                      >
                        <Icon size={14} />
                      </span>
                      <div className="flex flex-col">
                        <span
                          className={
                            "text-[13px] font-semibold " +
                            (selected
                              ? "text-[var(--brand-fg-on-soft)]"
                              : "text-[var(--text-primary)]")
                          }
                        >
                          {opt.label}
                        </span>
                        <span className="text-[11.5px] text-[var(--text-tertiary)]">
                          {opt.desc}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Field>

            {err && (
              <div
                className={
                  "flex items-start gap-2 px-3 py-2.5 rounded-md " +
                  "bg-[var(--danger-soft)] border border-[var(--brand-soft-hover)]"
                }
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--brand)] mt-[7px] shrink-0" />
                <p className="text-[12.5px] text-[var(--danger-fg)] font-medium leading-relaxed">
                  {err}
                </p>
              </div>
            )}
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={loading}>
            {isEdit ? "Save changes" : "Create user"}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
