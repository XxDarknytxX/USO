// src/components/vouchers/VoucherCreateForm.jsx
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { voucherApi } from "../../services/api";
import toast from "react-hot-toast";
import { X, Loader2, Ticket, Sparkles, Clock, HardDrive, Users } from "lucide-react";

export default function VoucherCreateForm({ onClose, onCreated }) {
  const [userGroups, setUserGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    loadUserGroups();
  }, []);

  async function loadUserGroups() {
    setLoadingGroups(true);
    try {
      const data = await voucherApi.userGroups();
      setUserGroups(data.userGroups || []);
    } catch (err) {
      toast.error("Failed to load profiles: " + err.message);
    } finally {
      setLoadingGroups(false);
    }
  }

  async function handleSubmit() {
    if (!selectedGroup) {
      toast.error("Please select a profile");
      return;
    }
    if (quantity < 1 || quantity > 100) {
      toast.error("Quantity must be between 1 and 100");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        user_group_id: String(selectedGroup.id || selectedGroup.userGroupId),
        user_group_name: selectedGroup.name || selectedGroup.userGroupName || "",
        profile: selectedGroup.authProfileId || String(selectedGroup.id || selectedGroup.userGroupId),
        package_name: selectedGroup.name || selectedGroup.userGroupName || "",
        quantity,
      };
      const result = await voucherApi.create(payload);
      const count = result.count || 1;
      toast.success(`${count} voucher${count > 1 ? "s" : ""} created successfully`);
      onCreated();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function formatTime(minutes) {
    const m = Number(minutes || 0);
    if (m < 60) return `${m} min`;
    if (m < 1440) return `${Math.round(m / 60)} hours`;
    return `${Math.round(m / 1440)} days`;
  }

  function formatQuota(mb) {
    const val = Number(mb || 0);
    if (val < 1024) return `${val} MB`;
    return `${(val / 1024).toFixed(1)} GB`;
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        >
          {/* Accent bar */}
          <div className="h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400" />

          {/* Header */}
          <div className="px-6 pt-5 pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-200">
                  <Ticket className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Generate Vouchers</h2>
                  <p className="text-xs text-gray-500">Select a profile and quantity</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-all"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 pb-6 space-y-5">
            {/* Profile cards */}
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 block">
                Select Profile
              </label>

              {loadingGroups ? (
                <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                  <Loader2 size={24} className="animate-spin mb-2" />
                  <span className="text-sm">Loading profiles...</span>
                </div>
              ) : userGroups.length === 0 ? (
                <div className="text-center py-8 bg-red-50 rounded-2xl">
                  <p className="text-sm text-red-600 font-medium">No profiles found</p>
                  <p className="text-xs text-red-400 mt-1">Check your API connection</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {userGroups.map((g) => {
                    const gid = String(g.id || g.userGroupId);
                    const isSelected = selectedGroup && String(selectedGroup.id || selectedGroup.userGroupId) === gid;
                    return (
                      <motion.button
                        key={gid}
                        type="button"
                        onClick={() => setSelectedGroup(g)}
                        whileTap={{ scale: 0.98 }}
                        className={`w-full text-left p-4 rounded-2xl border-2 transition-all duration-200 ${
                          isSelected
                            ? "border-purple-500 bg-purple-50/80 shadow-md shadow-purple-100"
                            : "border-gray-100 bg-gray-50/50 hover:border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm font-semibold ${isSelected ? "text-purple-700" : "text-gray-800"}`}>
                            {g.name || g.userGroupName}
                          </span>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                            isSelected ? "border-purple-500 bg-purple-500" : "border-gray-300"
                          }`}>
                            {isSelected && (
                              <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="w-2 h-2 bg-white rounded-full"
                              />
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                          {g.timePeriod != null && (
                            <span className="flex items-center gap-1">
                              <Clock size={10} /> {formatTime(g.timePeriod)}
                            </span>
                          )}
                          {g.quota != null && (
                            <span className="flex items-center gap-1">
                              <HardDrive size={10} /> {formatQuota(g.quota)}
                            </span>
                          )}
                          {g.noOfDevice != null && (
                            <span className="flex items-center gap-1">
                              <Users size={10} /> {g.noOfDevice} device{g.noOfDevice > 1 ? "s" : ""}
                            </span>
                          )}
                          {g.voucherCount > 0 && (
                            <span className="flex items-center gap-1 text-purple-500">
                              <Ticket size={10} /> {g.voucherCount} active
                            </span>
                          )}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Quantity stepper */}
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                Quantity
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-lg transition-colors flex items-center justify-center"
                >
                  -
                </button>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                  className="flex-1 h-10 text-center text-lg font-bold text-gray-800 border-2 border-gray-100 rounded-xl focus:outline-none focus:border-purple-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={() => setQuantity(Math.min(100, quantity + 1))}
                  className="w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-lg transition-colors flex items-center justify-center"
                >
                  +
                </button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                {[1, 5, 10, 25, 50].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setQuantity(n)}
                    className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                      quantity === n
                        ? "bg-purple-100 text-purple-700"
                        : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

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
                type="button"
                onClick={handleSubmit}
                disabled={submitting || loadingGroups || !selectedGroup}
                className="flex-[1.5] h-11 text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-pink-500 rounded-xl hover:from-purple-700 hover:to-pink-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-purple-200 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Sparkles size={16} />
                )}
                {submitting ? "Generating..." : `Generate ${quantity > 1 ? quantity + " " : ""}Voucher${quantity > 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
