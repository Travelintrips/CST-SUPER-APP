/**
 * kill-port.mjs <port> [port2 ...]
 * Finds and SIGKILLs processes listening on the given TCP ports.
 * Works on NixOS/Replit where fuser/ss/lsof may be unavailable.
 */
import fs from "node:fs";

function findPids(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const f of ["/proc/net/tcp6", "/proc/net/tcp"]) {
    try {
      for (const line of fs.readFileSync(f, "utf8").split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts[1]?.endsWith(":" + hex)) inodes.add(parts[9]);
      }
    } catch {}
  }
  if (!inodes.size) return [];
  const pids = new Set();
  try {
    for (const pid of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
          try {
            const link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
            if (link.startsWith("socket:[") && inodes.has(link.slice(8, -1))) {
              pids.add(Number(pid));
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return [...pids];
}

const ports = process.argv.slice(2).map(Number).filter(Boolean);
let killed = 0;
for (const port of ports) {
  const pids = findPids(port);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
      console.log(`[kill-port] killed PID ${pid} (port ${port})`);
      killed++;
    } catch (e) {
      console.log(`[kill-port] could not kill PID ${pid}: ${e.message}`);
    }
  }
  if (!pids.length) console.log(`[kill-port] port ${port}: no process`);
}
process.exit(killed > 0 ? 0 : 0);
