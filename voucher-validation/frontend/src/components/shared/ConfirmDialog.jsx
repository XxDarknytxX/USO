// src/components/shared/ConfirmDialog.jsx
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Info } from "lucide-react";

export default function ConfirmDialog({
  open,
  title = "Confirm Action",
  message = "Are you sure?",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel,
}) {
  const isDanger = variant === "danger";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
          />
          <motion.div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            initial={{ scale: 0.9, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 10 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`h-1 ${isDanger ? "bg-gradient-to-r from-red-500 to-orange-400" : "bg-gradient-to-r from-purple-500 to-pink-500"}`} />
            <div className="p-6">
              <div className="flex items-start gap-3 mb-5">
                <div className={`p-2.5 rounded-xl shrink-0 ${isDanger ? "bg-red-50" : "bg-purple-50"}`}>
                  {isDanger ? (
                    <AlertTriangle size={20} className="text-red-500" />
                  ) : (
                    <Info size={20} className="text-purple-500" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">{title}</h3>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">{message}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onCancel}
                  className="flex-1 h-10 text-sm font-semibold text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all"
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={onConfirm}
                  className={`flex-1 h-10 text-sm font-semibold text-white rounded-xl transition-all shadow-lg ${
                    isDanger
                      ? "bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 shadow-red-200"
                      : "bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 shadow-purple-200"
                  }`}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
