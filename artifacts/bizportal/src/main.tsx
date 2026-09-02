import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installChunkLoadRecovery } from "@/lib/chunkLoadRecovery";

(window as any).__BASE_PATH__ = import.meta.env.BASE_URL || "/bizportal/";

// A user can keep an older HTML document open while a new deployment replaces
// its hashed lazy chunks. Vite emits this event when that stale chunk is gone;
// reload once so the browser receives the current HTML and asset manifest.
installChunkLoadRecovery();

// No portal relay needed — Customer Portal handles its own OAuth redirect directly.

createRoot(document.getElementById("root")!).render(<App />);
