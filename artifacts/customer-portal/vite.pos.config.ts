import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;
const isBuildMode = process.argv.includes("build");
if (!isBuildMode && !rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}
const port = Number(rawPort ?? "5000");
const basePath = "/";

// Inject script redirect ke index.html — berjalan sebelum React dimuat
function posInjectPlugin() {
  return {
    name: "pos-inject-html",
    transformIndexHtml(html: string) {
      const script = `<script>
(function(){
  var p = window.location.pathname;
  var ok = p.startsWith('/kasir') || p.startsWith('/menu-board');
  if(!ok){ window.location.replace('/kasir/login'); }
})();
</script>`;
      return html.replace("<head>", "<head>" + script);
    },
  };
}

// Paksa semua request non-kasir ke /kasir/login (hardcoded, tanpa env var)
// Menggunakan HTML + meta-refresh + JS redirect agar tidak bergantung pada
// browser/proxy yang meneruskan HTTP 302
function posRedirectPlugin() {
  return {
    name: "pos-redirect",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "/").split("?")[0];
        const isKasirPath =
          url.startsWith("/kasir") || url.startsWith("/menu-board");
        const isViteInternal =
          url.startsWith("/@") ||
          url.startsWith("/__vite") ||
          url.startsWith("/node_modules") ||
          url.startsWith("/src") ||
          url.startsWith("/api/");
        const isStaticAsset =
          /\.(js|jsx|mjs|cjs|ts|tsx|css|scss|svg|png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|map|json|webp|mp4|webm|html)$/.test(url);
        const isAllowed = isKasirPath || isViteInternal || isStaticAsset;
        if (!isAllowed) {
          const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>Redirecting...</title>
</head><body>
<script>
(async function(){
  if('serviceWorker' in navigator){
    const regs = await navigator.serviceWorker.getRegistrations();
    for(const r of regs) await r.unregister();
  }
  if('caches' in window){
    const keys = await caches.keys();
    for(const k of keys) await caches.delete(k);
  }
  window.location.replace('/kasir/login');
})();
</script>
<p>Mengalihkan ke halaman login...</p>
</body></html>`;
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(html);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: basePath,
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ""),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ""),
    "import.meta.env.VITE_SUPABASE_URL_DEV": JSON.stringify(process.env.VITE_SUPABASE_URL_DEV ?? process.env.SUPABASE_URL_DEV ?? ""),
    "import.meta.env.VITE_SUPABASE_ANON_KEY_DEV": JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY_DEV ?? process.env.SUPABASE_ANON_KEY_DEV ?? ""),
    "import.meta.env.VITE_REPLIT_DEV_DOMAIN": JSON.stringify(process.env.REPLIT_DEV_DOMAIN ?? ""),
    "import.meta.env.VITE_POS_MODE": JSON.stringify("true"),
  },
  plugins: [
    posInjectPlugin(),
    posRedirectPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({ root: path.resolve(import.meta.dirname, "..") }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port,
    strictPort: false,
    host: "0.0.0.0",
    allowedHosts: true,
    watch: {
      ignored: [
        "**/node_modules/**",
        path.resolve(import.meta.dirname, "../api-server/**"),
        path.resolve(import.meta.dirname, "../bizportal/**"),
        path.resolve(import.meta.dirname, "../cst-driver/**"),
        path.resolve(import.meta.dirname, "../logistic-order/**"),
        path.resolve(import.meta.dirname, "../mockup-sandbox/**"),
      ],
    },
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/bizportal": { target: "http://localhost:8080", changeOrigin: true, ws: true },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
