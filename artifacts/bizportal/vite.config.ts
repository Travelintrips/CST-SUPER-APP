import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 3000;

const basePath = process.env.BASE_PATH ?? "/bizportal/";

// In dev (non-deployment), prefer *_DEV variants so they match the API server's
// sport_center Supabase connection (SUPABASE_URL_DEV / SUPABASE_ANON_KEY_DEV).
// In production, use the VITE_SUPABASE_* secrets or SUPABASE_* configs.
const isDeploy = !!process.env.REPLIT_DEPLOYMENT;
const resolvedSupabaseUrl = isDeploy
  ? (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "")
  : (process.env.SUPABASE_URL_DEV ?? process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "");
const resolvedSupabaseAnonKey = isDeploy
  ? (process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "")
  : (process.env.SUPABASE_ANON_KEY_DEV ?? process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "");

export default defineConfig({
  base: basePath,
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(resolvedSupabaseUrl),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(resolvedSupabaseAnonKey),
    "import.meta.env.VITE_REPLIT_DEV_DOMAIN": JSON.stringify(process.env.REPLIT_DEV_DOMAIN ?? ""),
    "import.meta.env.VITE_GOOGLE_MAPS_API_KEY": JSON.stringify(process.env.GOOGLE_MAPS_API_KEY ?? ""),
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(process.env.VITE_API_BASE_URL ?? ""),
  },
  plugins: [
    {
      name: "redirect-root-to-base",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === "/" && basePath !== "/") {
            // Serve an HTML page so client-side JS can forward the hash fragment
            // (e.g. #access_token=... from Supabase OAuth) to the customer portal.
            // A plain 302 redirect would lose the hash because it is client-only.
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Redirecting…</title>
<script>
var h = window.location.hash;
var s = window.location.search;
// If this looks like a Supabase OAuth callback, forward to customer portal
if (h.indexOf('access_token') !== -1 || h.indexOf('error=') !== -1 ||
    s.indexOf('code=') !== -1 || s.indexOf('error=') !== -1) {
  window.location.replace('/customer-portal/' + s + h);
} else {
  window.location.replace('/bizportal/');
}
</script></head><body>Redirecting…</body></html>`);
            return;
          }
          next();
        });
      },
    },
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
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
      "@workspace/replit-auth-web": path.resolve(import.meta.dirname, "../../lib/replit-auth-web/src/index.ts"),
      "@workspace/product-templates": path.resolve(import.meta.dirname, "../../lib/product-templates/src/index.ts"),
      "@workspace/logistics-constants": path.resolve(import.meta.dirname, "../../lib/logistics-constants/src/index.ts"),
      "react": path.resolve(import.meta.dirname, "node_modules/react"),
      "react-dom": path.resolve(import.meta.dirname, "node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(import.meta.dirname, "node_modules/react/jsx-runtime"),
      "react/jsx-dev-runtime": path.resolve(import.meta.dirname, "node_modules/react/jsx-dev-runtime"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "@radix-ui/react-progress",
      "@radix-ui/react-accordion",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-avatar",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-collapsible",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-label",
      "@radix-ui/react-navigation-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-radio-group",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@radix-ui/react-slider",
      "@radix-ui/react-slot",
      "@radix-ui/react-switch",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "@radix-ui/react-toggle",
      "@radix-ui/react-toggle-group",
      "@radix-ui/react-tooltip",
      "@tanstack/react-query",
      "lucide-react",
      "wouter",
      "clsx",
      "tailwind-merge",
      "class-variance-authority",
      "framer-motion",
      "sonner",
      "recharts",
      "date-fns",
    ],
    force: false,
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === "SOURCEMAP_ERROR") return;
        warn(warning);
      },
      output: {
        manualChunks(id) {
          // ExcelJS is large (~3 MB) and only needed on export — keep in its own chunk
          if (id.includes("node_modules/exceljs") || id.includes("node_modules/archiver") || id.includes("node_modules/jszip")) {
            return "vendor-excel";
          }
          // Recharts + d3 deps
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-") || id.includes("node_modules/victory-")) {
            return "vendor-charts";
          }
          // Framer Motion
          if (id.includes("node_modules/framer-motion")) {
            return "vendor-motion";
          }
          // Radix UI
          if (id.includes("node_modules/@radix-ui")) {
            return "vendor-radix";
          }
          // React core
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/scheduler/")) {
            return "vendor-react";
          }
          // Tanstack query
          if (id.includes("node_modules/@tanstack")) {
            return "vendor-query";
          }
        },
      },
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    hmr: false,
    headers: {
      "X-Frame-Options": "ALLOWALL",
      "Content-Security-Policy": "frame-ancestors *",
    },
    watch: {
      ignored: [
        "**/node_modules/**",
        path.resolve(import.meta.dirname, "../api-server/**"),
        path.resolve(import.meta.dirname, "../customer-portal/**"),
        path.resolve(import.meta.dirname, "../logistic-order/**"),
        path.resolve(import.meta.dirname, "../mockup-sandbox/**"),
      ],
    },
    fs: {
      strict: false,
    },
    proxy: {
      "/api": {
        // The API server runs on 8080 in the unified Gateway and in the
        // standalone artifact workflow. Keep explicit overrides for legacy
        // forwarders, but never fall back to the old unused 18444 port.
        target: `http://localhost:${process.env.API_PORT ?? process.env.FORWARDER_PORT ?? 8080}`,
        changeOrigin: true,
        ws: true,
      },
      "/wa-gateway": {
        target: "http://localhost:8000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
