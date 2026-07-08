/**
 * Floating Blobs Background — ambient gradient lighting (Service Desk).
 * Large blurred accent gradient blobs + base radial gradient + noise + grid.
 * Pure CSS; respects prefers-reduced-motion via the animation utilities.
 */

import { useTheme } from "../../contexts/theme";

export default function FloatingBlobs({ variant = "default" }) {
  const { theme } = useTheme();
  const isLight = theme === "light";

  const variants = {
    default: [
      { gradient: "bg-gradient-to-br from-[var(--accent)]/20 via-[var(--accent)]/10 to-transparent", size: "w-[900px] h-[600px]", position: "-top-[200px] -left-[200px]", blur: "blur-[150px]", animation: "animate-float-slow", delay: "" },
      { gradient: "bg-gradient-to-br from-rose-500/10 via-pink-500/5 to-transparent", size: "w-[600px] h-[800px]", position: "-right-[150px] top-[20%]", blur: "blur-[120px]", animation: "animate-float-delayed", delay: "delay-2000" },
      { gradient: "bg-gradient-to-br from-orange-500/8 via-amber-500/5 to-transparent", size: "w-[500px] h-[500px]", position: "bottom-[10%] -left-[100px]", blur: "blur-[100px]", animation: "animate-float", delay: "delay-3000" },
    ],
    minimal: [
      { gradient: "bg-gradient-to-br from-[var(--accent)]/10 to-transparent", size: "w-[600px] h-[400px]", position: "-top-[100px] -right-[100px]", blur: "blur-[120px]", animation: "animate-float-slow", delay: "" },
      { gradient: "bg-gradient-to-br from-rose-500/5 to-transparent", size: "w-[400px] h-[300px]", position: "bottom-[20%] -left-[50px]", blur: "blur-[100px]", animation: "animate-float-delayed", delay: "delay-2000" },
    ],
    subtle: [
      { gradient: "bg-gradient-to-br from-[var(--accent)]/8 to-transparent", size: "w-[500px] h-[400px]", position: "-top-[50px] -left-[50px]", blur: "blur-[100px]", animation: "animate-float-slow", delay: "" },
      { gradient: "bg-gradient-to-br from-slate-500/5 to-transparent", size: "w-[400px] h-[300px]", position: "-right-[50px] top-[30%]", blur: "blur-[80px]", animation: "animate-float-delayed", delay: "delay-2000" },
    ],
  };

  const blobs = variants[variant] || variants.default;

  return (
    <div
      className={`pointer-events-none fixed inset-0 overflow-hidden -z-10 transition-opacity duration-500 ${isLight ? "opacity-40" : "opacity-100"}`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-radial-gradient" />
      <div className="absolute inset-0 bg-noise opacity-50" />
      {blobs.map((blob, i) => (
        <div key={i} className={`absolute rounded-full ${blob.gradient} ${blob.size} ${blob.position} ${blob.blur} ${blob.animation} ${blob.delay}`} />
      ))}
      <div className="absolute inset-0 bg-grid opacity-30" />
    </div>
  );
}
