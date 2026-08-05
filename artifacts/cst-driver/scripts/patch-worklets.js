#!/usr/bin/env node
/**
 * Patches react-native-worklets package.json to add proper "exports" field.
 * react-native-worklets@0.5.x ships with `"exports": {}` (empty object) which
 * causes Node.js 24 to block `require('react-native-worklets/plugin')`.
 */
const fs = require("fs");
const path = require("path");

function findWorklets(startDir) {
  const dirs = [
    path.resolve(startDir, "node_modules", "react-native-worklets"),
    path.resolve(startDir, "..", "..", "node_modules", "react-native-worklets"),
  ];
  // Also scan pnpm virtual store
  const store = path.resolve(startDir, "..", "..", "node_modules", ".pnpm");
  if (fs.existsSync(store)) {
    for (const entry of fs.readdirSync(store)) {
      if (entry.startsWith("react-native-worklets@")) {
        dirs.push(
          path.resolve(store, entry, "node_modules", "react-native-worklets")
        );
      }
    }
  }
  return dirs;
}

const pkgDirs = findWorklets(__dirname);
let patched = 0;

for (const dir of pkgDirs) {
  const pkgFile = path.join(dir, "package.json");
  if (!fs.existsSync(pkgFile)) continue;

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  } catch {
    continue;
  }

  const currentExports = JSON.stringify(pkg.exports ?? null);
  if (currentExports !== "null" && currentExports !== "{}") {
    console.log(`[patch-worklets] Already patched: ${pkgFile}`);
    continue;
  }

  pkg.exports = {
    ".": {
      require: "./src/index.js",
      import: "./src/index.js",
      default: "./src/index.js",
    },
    "./plugin": {
      require: "./plugin/index.js",
      default: "./plugin/index.js",
    },
  };

  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2), "utf8");
  console.log(`[patch-worklets] Patched: ${pkgFile}`);
  patched++;
}

if (patched === 0) {
  console.log("[patch-worklets] No package.json files needed patching.");
}
