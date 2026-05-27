// src/components/shared/StatusBadge.jsx

// Ruijie Cloud status codes:
//   '1' = Unused (not yet activated)
//   '2' = In-use  (active / connected)
//   '3' = Expired
const statusConfig = {
  "1": { label: "Unused", bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  "0": { label: "Inactive", bg: "bg-gray-50", text: "text-gray-600", dot: "bg-gray-400" },
  "2": { label: "Active", bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500" },
  "3": { label: "Expired", bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
};

export default function StatusBadge({ status, className = "" }) {
  const config = statusConfig[String(status)] || statusConfig["0"];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
