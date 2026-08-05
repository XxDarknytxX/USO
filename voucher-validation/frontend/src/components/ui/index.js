// src/components/ui/index.js
// Barrel export for design-system primitives.
// Usage: import { Button, Input, Field, Modal } from "@/components/ui";

export { default as Button, IconButton } from "./Button";
export { default as Modal } from "./Modal";
export { default as ConfirmDialog } from "./ConfirmDialog";
export { Field, Input, Select, Textarea, Toggle, TagInput } from "./Field";
export {
  Card,
  CardHeader,
  CardBody,
  Badge,
  Section,
  EmptyState,
  Kbd,
} from "./Surface";

/* --- Service Desk primitives (dashboards + reskin) --- */
export { default as PageHeader, SectionHeader } from "./PageHeader";
export { default as Tabs } from "./Tabs";
export { GlassCard, StatCard, Panel } from "./StatCard";
export {
  default as Skeleton,
  SkeletonText,
  SkeletonKpis,
  SkeletonCard,
  SkeletonTable,
} from "./Skeleton";
export {
  CHART_COLORS,
  CHART_SERIES,
  useChartTheme,
  ChartTooltip,
  ChartGradient,
  // Shared chart furniture so every chart reads as one system.
  BAR_RADIUS,
  BAR_MAX_SIZE,
  BAR_CATEGORY_GAP,
  axisX,
  axisY,
  gridProps,
  ChartStat,
  LegendRow,
  LegendRows,
} from "./chart";
