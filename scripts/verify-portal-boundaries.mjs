#!/usr/bin/env node

/**
 * Verify that BizPortal and Customer Portal remain independently runnable
 * frontend packages. The API and shared libraries are intentional boundaries;
 * one portal must not import the other portal's source directly.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "..");

const portals = [
  {
    name: "BizPortal",
    directory: "artifacts/bizportal",
    packageName: "@workspace/bizportal",
    basePath: "/bizportal/",
  },
  {
    name: "Customer Portal",
    directory: "artifacts/customer-portal",
    packageName: "@workspace/customer-portal",
    basePath: "/",
  },
];

const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const failures = [];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    failures.push(`${path.relative(workspaceRoot, filePath)}: invalid JSON (${error.message})`);
    return null;
  }
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath);
    return sourceExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

for (const portal of portals) {
  const root = path.join(workspaceRoot, portal.directory);
  const packagePath = path.join(root, "package.json");
  const viteConfigPath = path.join(root, "vite.config.ts");
  const startScriptPath = path.join(root, "start-dev.sh");

  if (!fs.existsSync(root)) {
    failures.push(`${portal.name}: missing package directory ${portal.directory}`);
    continue;
  }

  const packageJson = readJson(packagePath);
  if (packageJson) {
    if (packageJson.name !== portal.packageName) {
      failures.push(`${portal.name}: package name must be ${portal.packageName}`);
    }
    for (const script of ["dev", "build", "typecheck"]) {
      if (typeof packageJson.scripts?.[script] !== "string") {
        failures.push(`${portal.name}: package.json must define scripts.${script}`);
      }
    }
  }

  if (!fs.existsSync(viteConfigPath)) {
    failures.push(`${portal.name}: missing vite.config.ts`);
  } else {
    const viteConfig = fs.readFileSync(viteConfigPath, "utf8");
    if (!viteConfig.includes(`const basePath = process.env.BASE_PATH ?? "${portal.basePath}"`)) {
      failures.push(`${portal.name}: Vite base path must default to ${portal.basePath}`);
    }
  }

  if (!fs.existsSync(startScriptPath)) {
    failures.push(`${portal.name}: missing start-dev.sh`);
  }

  for (const sourceFile of listFiles(path.join(root, "src"))) {
    const source = fs.readFileSync(sourceFile, "utf8");
    if (source.includes("@workspace/bizportal") || source.includes("@workspace/customer-portal")) {
      failures.push(
        `${path.relative(workspaceRoot, sourceFile)}: portal source must not import another portal package`,
      );
    }
    if (source.includes("artifacts/bizportal") || source.includes("artifacts/customer-portal")) {
      failures.push(
        `${path.relative(workspaceRoot, sourceFile)}: portal source must not reference another portal path`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("[portal-boundaries] FAILED — portal project boundary check blocked.");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  "[portal-boundaries] OK — BizPortal and Customer Portal are independent frontend packages with a shared API boundary.",
);