import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "artifacts/api-server");

// API_PORT: the real Express server port (internal)
// The port-forwarder in start-dev.sh opens FORWARDER_PORT immediately so the
// platform "waitForPort" check passes while migrations run.
// We run API on 8090 internally and forward 8080 → 8090 immediately.
const child = spawn("bash", ["start-dev.sh"], {
  cwd: dir,
  stdio: "inherit",
  env: {
    ...process.env,
    API_PORT: "8090",
    FORWARDER_PORT: "8080",
  },
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT",  () => child.kill("SIGINT"));
