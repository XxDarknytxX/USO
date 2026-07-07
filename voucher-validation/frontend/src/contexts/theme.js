// Compatibility shim.
// Service Desk UI primitives import `useTheme` from `../../contexts/theme`.
// The admin's real hook lives in hooks/useTheme.js and returns { theme, setTheme, toggle }.
export { useTheme } from "../hooks/useTheme";
