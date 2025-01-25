import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App"; // Change this import to the new main App component
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found.");
}

const root = createRoot(rootElement);

root.render(
  process.env.NODE_ENV === "development" ? (
    <App />
  ) : (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
);
