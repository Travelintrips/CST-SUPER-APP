import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const port = Number(process.env.PORT ?? "3000");

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      process.env.VITE_SUPABASE_URL ??
      process.env.SUPABASE_URL ??
      ""
    ),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
      process.env.VITE_SUPABASE_ANON_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      ""
    ),
    "import.meta.env.VITE_SUPABASE_URL_DEV": JSON.stringify(process.env.VITE_SUPABASE_URL_DEV ?? process.env.SUPABASE_URL_DEV ?? ""),
    "import.meta.env.VITE_SUPABASE_ANON_KEY_DEV": JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY_DEV ?? process.env.SUPABASE_ANON_KEY_DEV ?? ""),
    "import.meta.env.VITE_REPLIT_DEV_DOMAIN": JSON.stringify(process.env.REPLIT_DEV_DOMAIN ?? ""),
    "import.meta.env.VITE_GOOGLE_MAPS_API_KEY": JSON.stringify(process.env.GOOGLE_MAPS_API_KEY ?? ""),
    // External map/routing service URLs — override via env var in production
    "import.meta.env.VITE_OSRM_URL": JSON.stringify(
      process.env.VITE_OSRM_URL ?? "https://router.project-osrm.org"
    ),
    "import.meta.env.VITE_MAP_TILE_URL": JSON.stringify(
      process.env.VITE_MAP_TILE_URL ?? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    ),
  },
  plugins: [
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
      "@workspace/product-templates": path.resolve(import.meta.dirname, "../../lib/product-templates/src/index.ts"),
      "@workspace/service-templates": path.resolve(import.meta.dirname, "../../lib/service-templates/src/index.ts"),
      "@workspace/logistics-constants": path.resolve(import.meta.dirname, "../../lib/logistics-constants/src/index.ts"),
    },
    dedupe: ["react", "react-dom"],
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
        // Do NOT use manualChunks for node_modules. Custom chunk splitting of CJS
        // packages (react, radix, supabase, etc.) causes Rollup's cross-chunk CJS
        // interop to fail at runtime: packages like use-sync-external-store call
        // require('react') across chunk boundaries, and Rollup's ESM wrapper does not
        // properly expose named exports (useLayoutEffect, Children, etc.), resulting in
        // "Cannot read properties of undefined" errors on first load.
        //
        // Rollup's automatic chunking (driven by dynamic import() boundaries) handles
        // CJS interop correctly by keeping shared dependencies in the same evaluation
        // scope. Route-level code splitting is preserved via React.lazy() + dynamic
        // imports that already exist in the app.
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "microphone=(), geolocation=()",
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: https: blob:",
        "connect-src 'self' https: wss: ws: http://localhost:*",
        "media-src 'self' https: blob:",
        "worker-src 'self' blob:",
        "frame-ancestors 'self' https://replit.com https://*.replit.dev https://*.sisko.replit.dev",
        "object-src 'none'",
        "base-uri 'self'",
      ].join("; "),
    },
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
    hmr: process.env.REPLIT_DEV_DOMAIN
      ? { clientPort: 443, host: process.env.REPLIT_DEV_DOMAIN, protocol: "wss" }
      : true,
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.API_PORT ?? process.env.FORWARDER_PORT ?? 18444}`,
        changeOrigin: true,
      },
      // /sitemap.xml intentionally NOT proxied — served as a static file from public/
      "/q": {
        target: `http://localhost:${process.env.API_PORT ?? process.env.FORWARDER_PORT ?? 18444}`,
        changeOrigin: true,
      },
      // BizPortal dev server — proxied so /bizportal/* works via main entry port
      "/bizportal": {
        target: `http://localhost:${process.env.BIZPORTAL_PORT ?? 4200}`,
        changeOrigin: true,
        ws: true,
      },
      "/logistic-order": {
        target: `http://localhost:${process.env.LOGISTIC_ORDER_PORT ?? 19368}`,
        changeOrigin: true,
        ws: true,
      },
      "/wa-gateway": {
        target: `http://localhost:${process.env.WA_GATEWAY_PORT ?? 8000}`,
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
