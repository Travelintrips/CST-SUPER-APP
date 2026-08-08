import http from "node:http";
import net from "node:net";

const LISTEN_PORT = Number(process.env.PORT ?? 5000);
const UPSTREAM_PORT = Number(process.env.BIZPORTAL_PORT ?? 6800);

function upstreamPath(url) {
  return url === "/" ? "/bizportal/" : url;
}

const server = http.createServer((req, res) => {
  const proxy = http.request(
    {
      hostname: "127.0.0.1",
      port: UPSTREAM_PORT,
      path: upstreamPath(req.url ?? "/"),
      method: req.method,
      headers: req.headers,
    },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    },
  );

  proxy.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end("BizPortal preview unavailable");
  });

  req.pipe(proxy);
});

server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(UPSTREAM_PORT, "127.0.0.1", () => {
    const requestLine = `${req.method} ${upstreamPath(req.url ?? "/")} HTTP/1.1\r\n`;
    const headers = Object.entries(req.headers)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`)
      .join("");
    upstream.write(`${requestLine}${headers}\r\n`);
    if (head.length > 0) upstream.write(head);
  });

  const close = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on("error", close);
  socket.on("error", () => upstream.destroy());
  socket.pipe(upstream);
  upstream.pipe(socket);
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  console.log(`[PORT CHECK] PORT=${LISTEN_PORT} SERVICE=bizportal-preview`);
  console.log(`[bizportal-preview] :${LISTEN_PORT} -> :${UPSTREAM_PORT}`);
});