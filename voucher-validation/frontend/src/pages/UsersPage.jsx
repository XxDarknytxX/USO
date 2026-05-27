// src/pages/UsersPage.jsx
import { useState, useEffect } from "react";
import { userApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import ConfirmDialog from "../components/shared/ConfirmDialog";
import {
  Users,
  UserPlus,
  Trash2,
  Shield,
  Eye,
  X,
  Mail,
  Lock,
  User,
  EyeOff,
  Edit3,
  RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";

function generatePassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
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
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-200">
              <Users className="w-5 h-5 text-white" />
            </div>
            User Management
          </h1>
          <p className="text-sm text-gray-400 mt-1 ml-[52px]">
            Manage who can access the system
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-sm font-semibold hover:from-purple-700 hover:to-pink-600 transition-all shadow-lg shadow-purple-200 active:scale-[0.97]"
        >
          <UserPlus size={16} />
          Add User
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-4">
                User
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-4">
                Role
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-4">
                Joined
              </th>
              <th className="text-right text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-4">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="text-center py-16 text-gray-300">
                  <div className="w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto" />
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-16 text-gray-400 text-sm">
                  No users found
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                >
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {u.name || "\u2014"}
                      </p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                        u.role === "admin"
                          ? "bg-purple-50 text-purple-600"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {u.role === "admin" ? (
                        <Shield size={12} />
                      ) : (
                        <Eye size={12} />
                      )}
                      {u.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-400">
                    {new Date(u.created_at).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditTarget(u)}
                        className="p-2 rounded-lg text-gray-300 hover:text-purple-500 hover:bg-purple-50 transition-all"
                        title="Edit user"
                      >
                        <Edit3 size={15} />
                      </button>
                      {u.email !== currentEmail && (
                        <button
                          onClick={() => setDeleteTarget(u)}
                          className="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"
                          title="Delete user"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                      {u.email === currentEmail && (
                        <span className="text-xs text-gray-300 italic px-2">You</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create User Modal */}
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

      {/* Edit User Modal */}
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

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete User"
        message={`Remove ${deleteTarget?.email}? They will lose access immediately.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

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

  const set = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  function handleGenPassword() {
    const pw = generatePassword();
    setForm((prev) => ({ ...prev, password: pw }));
    setShowPassword(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      if (isEdit) {
        // Only send changed fields
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-purple-500 to-pink-500" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-0">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            {isEdit ? (
              <Edit3 size={18} className="text-purple-500" />
            ) : (
              <UserPlus size={18} className="text-purple-500" />
            )}
            {isEdit ? "Edit User" : "Add User"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Name
            </label>
            <div className="flex items-center rounded-xl border border-gray-200 bg-gray-50/80 hover:border-gray-300 focus-within:border-purple-400 focus-within:ring-[3px] focus-within:ring-purple-100 focus-within:bg-white transition-all">
              <div className="pl-3 pr-1">
                <User size={15} className="text-gray-300" />
              </div>
              <input
                type="text"
                value={form.name}
                onChange={set("name")}
                placeholder="Full name"
                className="flex-1 bg-transparent px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Email {!isEdit && "*"}
            </label>
            <div className="flex items-center rounded-xl border border-gray-200 bg-gray-50/80 hover:border-gray-300 focus-within:border-purple-400 focus-within:ring-[3px] focus-within:ring-purple-100 focus-within:bg-white transition-all">
              <div className="pl-3 pr-1">
                <Mail size={15} className="text-gray-300" />
              </div>
              <input
                type="email"
                value={form.email}
                onChange={set("email")}
                placeholder="user@example.com"
                required
                className="flex-1 bg-transparent px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Password {!isEdit && "*"}
              {isEdit && (
                <span className="normal-case text-gray-300 font-normal ml-1">
                  (leave blank to keep current)
                </span>
              )}
            </label>
            <div className="flex items-center rounded-xl border border-gray-200 bg-gray-50/80 hover:border-gray-300 focus-within:border-purple-400 focus-within:ring-[3px] focus-within:ring-purple-100 focus-within:bg-white transition-all">
              <div className="pl-3 pr-1">
                <Lock size={15} className="text-gray-300" />
              </div>
              <input
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={set("password")}
                placeholder={isEdit ? "New password" : "Min 6 characters"}
                required={!isEdit}
                minLength={form.password ? 6 : undefined}
                className="flex-1 bg-transparent px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                className="px-1 text-gray-300 hover:text-gray-500 transition-colors"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
              <button
                type="button"
                onClick={handleGenPassword}
                tabIndex={-1}
                title="Generate random password"
                className="pr-3 pl-1 text-gray-300 hover:text-purple-500 transition-colors"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            {form.password && showPassword && (
              <p className="mt-1.5 text-xs text-purple-500 font-mono bg-purple-50 px-3 py-1.5 rounded-lg break-all">
                {form.password}
              </p>
            )}
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Role
            </label>
            <div className="flex gap-3">
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
                  desc: "Full access",
                  icon: Shield,
                },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({ ...prev, role: opt.value }))
                  }
                  className={`flex-1 flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                    form.role === opt.value
                      ? "border-purple-400 bg-purple-50"
                      : "border-gray-100 bg-gray-50/50 hover:border-gray-200"
                  }`}
                >
                  <opt.icon
                    size={16}
                    className={
                      form.role === opt.value
                        ? "text-purple-500"
                        : "text-gray-300"
                    }
                  />
                  <div className="text-left">
                    <p
                      className={`text-sm font-semibold ${
                        form.role === opt.value
                          ? "text-purple-700"
                          : "text-gray-600"
                      }`}
                    >
                      {opt.label}
                    </p>
                    <p className="text-[11px] text-gray-400">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {err && (
            <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
              <div className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
              <p className="text-sm text-red-600 font-medium">{err}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 text-sm font-semibold text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 h-11 text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-pink-500 rounded-xl hover:from-purple-700 hover:to-pink-600 transition-all shadow-lg shadow-purple-200 disabled:opacity-60"
            >
              {loading
                ? isEdit
                  ? "Saving..."
                  : "Creating..."
                : isEdit
                  ? "Save Changes"
                  : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
