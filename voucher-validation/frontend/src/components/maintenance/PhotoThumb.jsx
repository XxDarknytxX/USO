// src/components/maintenance/PhotoThumb.jsx
// One maintenance photo. The photo route is behind auth, so a plain <img src>
// cannot fetch it — the Bearer token has to go on the request. We pull it as a
// blob and hand the <img> an object URL instead, revoking it on unmount so a
// long session browsing reports does not leak blobs.

import { useEffect, useState } from "react";
import { X, ImageOff } from "lucide-react";
import { fetchPhotoObjectUrl } from "../../services/api";

export default function PhotoThumb({ photoId, caption, onRemove, onOpen }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl = null;
    fetchPhotoObjectUrl(photoId)
      .then((u) => {
        if (revoked) { URL.revokeObjectURL(u); return; }
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => setFailed(true));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={() => url && onOpen?.(url, caption)}
        className="block w-20 h-20 rounded-md overflow-hidden border border-[var(--border-default)] bg-[var(--surface-sunken)]"
        title={caption || "Open photo"}
      >
        {failed ? (
          <span className="w-full h-full flex items-center justify-center text-[var(--fg-muted)]">
            <ImageOff size={16} />
          </span>
        ) : url ? (
          <img src={url} alt={caption || "Maintenance photo"} className="w-full h-full object-cover" />
        ) : (
          <span className="block w-full h-full skeleton" />
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(photoId)}
          title="Remove photo"
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--brand)] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
