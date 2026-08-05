import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

(window as any).__BASE_PATH__ = import.meta.env.BASE_URL || "/bizportal/";

// No portal relay needed — Customer Portal handles its own OAuth redirect directly.

createRoot(document.getElementById("root")!).render(<App />);
