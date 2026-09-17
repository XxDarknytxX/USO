// src/components/maintenance/PhotoThumb.jsx
// One maintenance photo. The photo route is behind auth, so a plain <img src>
// cannot fetch it — the Bearer token has to go on the request. We pull it as a
// blob and hand the <img> an object URL instead, revoking it on unmount so a
// long session browsing reports does not leak blobs.
//
// This is the only real imagery in the console, so it is worth framing properly:
// a card-like tile with a hairline, a shimmer while the blob is in flight, and a
// hover state that says the photo opens. `size` exists because the same photo
// appears as a 20px-gutter contact sheet in a report and as a composed gallery
// tile on the village profile — "fill" hands sizing to the grid cell.

import { useEffect, useState } from "react";
import { X, ImageOff, Maximize2 } from "lucide-react";
import { fetchPhotoObjectUrl } from "../../services/api";

const SIZES = {
  xs: "h-14 w-14",
  sm: "h-16 w-16",
  md: "h-20 w-20",
  lg: "h-28 w-28",
  fill: "h-full w-full",
};

export default function PhotoThumb({ photoId, caption, onRemove, onOpen, size = "md", className = "" }) {
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

  // On a touch screen the remove control is always on show, sitting where a
  // thumb reaching for the photo can land on it, so there it asks first. With
  // a mouse it only appears on hover and removes straight away, as before.
  function remove() {
    const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    if (touch && !window.confirm("Remove this photo?")) return;
    onRemove(photoId);
  }

  const box = SIZES[size] || SIZES.md;
  // Only the larger tiles have room for a caption strip; on a contact sheet it
  // would cover the photograph it is describing.
  const showCaption = caption && (size === "lg" || size === "fill");

  return (
    <div className={`relative group shrink-0 ${box} ${className}`}>
      <button
        type="button"
        onClick={() => url && onOpen?.(url, caption)}
        className={
          "block w-full h-full rounded-[12px] overflow-hidden relative " +
          "border border-[var(--border-default)] bg-[var(--bg-surface)] " +
          "shadow-[var(--shadow-xs)] focus-ring " +
          "transition-[box-shadow,border-color] duration-200 " +
          "hover:border-[var(--border-hover)] hover:shadow-[var(--shadow-md)]"
        }
        title={caption || "Open photo"}
        aria-label={caption ? `Open photo: ${caption}` : "Open photo"}
      >
        {failed ? (
          <span className="w-full h-full flex items-center justify-center text-[var(--fg-subtle)]">
            <ImageOff size={16} />
          </span>
        ) : url ? (
          <>
            <img
              src={url}
              alt={caption || "Maintenance photo"}
              className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.06]"
            />
            {/* Hover affordance — the tile is a link to the lightbox, and without
                this a photograph looks like decoration rather than a control. */}
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center bg-[rgba(11,14,20,0.42)] opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            >
              <Maximize2 size={size === "xs" || size === "sm" ? 13 : 16} className="text-white drop-shadow" />
            </span>
            {showCaption && (
              <span className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-[rgba(11,14,20,0.78)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <span className="block text-[10.5px] font-medium text-white/90 truncate text-left">{caption}</span>
              </span>
            )}
          </>
        ) : (
          <span className="block w-full h-full skeleton" />
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={remove}
          title="Remove photo"
          aria-label="Remove photo"
          className={
            "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full " +
            "flex items-center justify-center " +
            // Keyboard users never trigger :hover, so the control has to appear
            // on focus too or it is unreachable without a mouse.
            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity " +
            // A touch screen has no hover at all: there the control is always
            // shown, and the button is a thumb-sized square in the tile's corner
            // around the same small red dot.
            "pointer-coarse:opacity-100 pointer-coarse:top-0 pointer-coarse:right-0 pointer-coarse:w-9 pointer-coarse:h-9"
          }
        >
          <span className="w-5 h-5 pointer-coarse:w-6 pointer-coarse:h-6 rounded-full bg-[var(--brand)] text-white flex items-center justify-center shadow-[var(--shadow-sm)]">
            <X size={11} />
          </span>
        </button>
      )}
    </div>
  );
}
