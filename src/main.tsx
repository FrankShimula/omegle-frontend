import react from "react";
import reactdom from "react-dom/client";
import ChatApp from "./App";
import "./index.css";

reactdom.createRoot(document.getElementById("root")!).render(
  process.env.NODE_ENV === "development" ? (
    <ChatApp />
  ) : (
    <react.StrictMode>
      <ChatApp />
    </react.StrictMode>
  )
);
