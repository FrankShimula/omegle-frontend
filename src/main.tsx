import React from "react"; // maintain default import for React
import { createRoot } from "react-dom/client"; // use named import for react-dom/client
import ChatApp from "./App";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found.");
}

const root = createRoot(rootElement);

root.render(
  process.env.NODE_ENV === "development" ? (
    <ChatApp />
  ) : (
    <React.StrictMode>
      <ChatApp />
    </React.StrictMode>
  )
);
