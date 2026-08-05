const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

// Patch jsc-safe-url so Metro doesn't crash when the Expo web HMR client
// sends a root-path entry URL ("https://HOST/?platform=web"). In Replit's
// proxy environment the web app runs at "/" — the HMR entry URL then has
// an empty pathname which the JSC validator rejects, killing Metro. We
// remap "/" → "/index" so the check passes without breaking bundling.
try {
  const jscSafeUrl = require("jsc-safe-url");
  if (typeof jscSafeUrl.toJscSafeUrl === "function") {
    const orig = jscSafeUrl.toJscSafeUrl.bind(jscSafeUrl);
    jscSafeUrl.toJscSafeUrl = function patchedToJscSafeUrl(url) {
      try {
        return orig(url);
      } catch (e) {
        if (String(e.message).includes("empty path")) {
          try {
            const u = new URL(url);
            if (u.pathname === "/") u.pathname = "/index";
            return orig(u.toString());
          } catch {}
        }
        throw e;
      }
    };
  }
} catch {}

const projectRoot = path.resolve(__dirname);
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Include the full workspace root so Metro can map workspace-relative bundle
// URLs (e.g. "artifacts/cst-driver/entry.bundle") to the correct file.
// Required for the production static build (scripts/build.js).
// Watch the entire workspace root so Metro's TreeFS includes pnpm's
// content-addressable store (.pnpm/PACKAGE@hash/node_modules/) in its
// file registry. Without this, Metro can follow the symlinks in
// artifacts/cst-driver/node_modules/ but its doesFileExist() check
// returns false for the files inside symlink targets, causing
// "Unable to resolve module expo-router/entry" in production builds.
//
// FallbackWatcher exclusions: to prevent ENOENT crashes when transient
// directories (pnpm install temp dirs, agent skill temp dirs) appear and
// disappear mid-crawl, we block those patterns via resolver.blockList.
config.watchFolders = [workspaceRoot];

// Resolve node_modules from both the package and the monorepo root (pnpm hoisting)
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Block the Metro CRAWLER (and FallbackWatcher) from descending into pnpm
// temporary directories created and deleted during `pnpm install`.
// FallbackWatcher (used when Watchman is unavailable) calls fs.watch() on
// every directory it crawls; if a dir vanishes mid-crawl it throws ENOENT
// and crashes Metro.  Patterns covered:
//   *_tmp_NNNN/**  — any pnpm package temp dir (e.g. path-scurry_tmp_10056)
//   .local/**      — agent skill temp dirs
config.resolver.blockList = /_tmp_\d+[/\\].*|[/\\]\.local[/\\].*/;
// Block transient directories that can vanish mid-crawl (pnpm install temp dirs,
// agent skill temp dirs). FallbackWatcher calls fs.watch() on every directory it
// finds; if one disappears it throws ENOENT and crashes Metro.
config.resolver.blockList = [
  // pnpm creates/removes *_tmp_NNNN dirs inside node_modules/.pnpm during installs
  /node_modules[/\\]\.pnpm[/\\][^/\\]+_tmp_\d+[/\\]/,
  // any _tmp_NNNN subdir anywhere in node_modules (e.g. @babel/template_tmp_1821)
  /_tmp_\d+[/\\]/,
  // agent skill temp dirs and local pnpm install staging dirs
  /[/\\]\.local[/\\]/,
  // Expo notifications native build artifacts
  /expo-notifications_tmp_[^/\\]+[/\\]/,
];

module.exports = config;
