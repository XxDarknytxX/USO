import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/main.css";
import App from "./App.jsx";
import { bootstrapTheme } from "./hooks/useTheme";

// Apply the persisted theme BEFORE React mounts to prevent a flash of wrong theme.
bootstrapTheme();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
