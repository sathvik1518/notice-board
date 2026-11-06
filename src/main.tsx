import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NoticeBoard } from "./NoticeBoard";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NoticeBoard />
  </StrictMode>,
);
