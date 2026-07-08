/**
 * Vodafone Logo — official speechmark asset (transparent PNG).
 * <VodafoneLogo size={36} className="..." />
 */

import logoUrl from "../../assets/vodafone-logo.png";

export default function VodafoneLogo({ size = 36, className }) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      className={className}
      alt="Vodafone"
      draggable={false}
      style={{ objectFit: "contain" }}
    />
  );
}
