import http from "http";
import net from "net";
import { execSync } from "child_process";

try { execSync("fuser -k 5000/tcp 2>/dev/null", { stdio: "ignore" }); } catch {}
await new Promise(r => setTimeout(r, 500));

const API_PORT = 18444;
const BIZPORTAL_PORT = 3000;
const CUSTOMER_PORTAL_PORT = 3001;
const POS_PORT = 3002;

function getTargetPort(url, headers) {
  if (
    url.startsWith("/api/") ||
    url === "/api" ||
    url.startsWith("/q/") ||
    url.startsWith("/logistic-order/api") ||
    url.startsWith("/auth/")
  ) return API_PORT;
  if (url.startsWith("/bizportal") || url.startsWith("/bizportal/")) return BIZPORTAL_PORT;
  if (url.startsWith("/kasir") || url.startsWith("/menu-board")) return POS_PORT;
  if (url.startsWith("/__customer_portal_hmr")) return CUSTOMER_PORTAL_PORT;
  if (headers && headers.referer) {
    if (headers.referer.includes("/bizportal")) return BIZPORTAL_PORT;
    if (headers.referer.includes("/kasir") || headers.referer.includes("/menu-board")) return POS_PORT;
  }
  return CUSTOMER_PORTAL_PORT;
}

function proxyRequest(req, res, port) {
  const options = {
    hostname: "localhost",
    port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${port}` },
  };
  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxy.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502);
    res.end("Bad Gateway: " + err.message);
  });
  req.pipe(proxy, { end: true });
}

// Proper WebSocket proxy using http.request upgrade event
function proxyWebSocket(req, socket, head, port) {
  const options = {
    hostname: "localhost",
    port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${port}` },
  };

  const proxyReq = http.request(options);

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    const statusLine = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}`;
    const headerLines = Object.entries(proxyRes.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join("\r\n");
    socket.write(`${statusLine}\r\n${headerLines}\r\n\r\n`);
    if (proxyHead && proxyHead.length) socket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    proxySocket.on("error", () => { try { socket.destroy(); } catch {} });
    socket.on("error", () => { try { proxySocket.destroy(); } catch {} });
  });

  proxyReq.on("error", () => { try { socket.destroy(); } catch {} });

  if (head && head.length) proxyReq.write(head);
  proxyReq.end();
}

const server = http.createServer((req, res) => {
  proxyRequest(req, res, getTargetPort(req.url || "/", req.headers));
});

server.on("upgrade", (req, socket, head) => {
  proxyWebSocket(req, socket, head, getTargetPort(req.url || "/", req.headers));
});

server.listen(5000, "0.0.0.0", () => {
  console.log("Proxy listening on :5000");
  console.log(`  /bizportal/* -> :${BIZPORTAL_PORT}`);
  console.log(`  /api/*       -> :${API_PORT}`);
  console.log(`  /*           -> :${CUSTOMER_PORTAL_PORT}`);
});
