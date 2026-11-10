// Postinstall bootstrap for machines whose system Node.js is older than Hardhat 3 supports.
//
// Hardhat 3 (and its native EVM, @nomicfoundation/edr) require Node.js >= 22.13. On such
// a machine this script does nothing. On an older Node.js it provisions, inside this
// project only (node_modules, never global):
//
//   1. a pinned Node.js 22 binary through the "node" npm package. npm puts
//      node_modules/.bin first on PATH for `npm run` and `npx`, so every script in
//      package.json transparently runs on it;
//   2. EDR's native binding for this platform, which npm silently skips when it runs on
//      an older Node.js (it is an optional dependency with "engines": ">= 22").
//
// Both are installed with --no-save, so package.json and the lockfile stay untouched.
// Opt out with SKIP_LOCAL_NODE=1 (then use nvm/fnm/Volta to get Node.js >= 22.13).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_NODE_VERSION = "22.23.4";
const MIN_NODE = [22, 13];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeModules = path.join(root, "node_modules");

function nodeIsSupported() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

function edrPlatformPackage() {
  const { platform, arch } = process;
  if (platform === "win32" && arch === "x64") return "edr-win32-x64-msvc";
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return `edr-darwin-${arch}`;
  if (platform === "linux" && (arch === "arm64" || arch === "x64")) {
    const glibc = process.report?.getReport()?.header?.glibcVersionRuntime;
    return `edr-linux-${arch}-${glibc ? "gnu" : "musl"}`;
  }
  return undefined;
}

function main() {
  if (process.env.SKIP_LOCAL_NODE === "1") return;

  const wanted = [];

  // `node` here is whatever npm scripts resolve first on PATH: the project-local binary
  // if it is already installed, otherwise the system one.
  if (!nodeIsSupported()) wanted.push(`node@${LOCAL_NODE_VERSION}`);

  const edrManifest = path.join(nodeModules, "@nomicfoundation", "edr", "package.json");
  const edrBinding = edrPlatformPackage();
  if (
    existsSync(edrManifest) &&
    edrBinding !== undefined &&
    !existsSync(path.join(nodeModules, "@nomicfoundation", edrBinding))
  ) {
    const { version } = JSON.parse(readFileSync(edrManifest, "utf8"));
    wanted.push(`@nomicfoundation/${edrBinding}@${version}`);
  }

  if (wanted.length === 0) return;

  console.log(
    `\n[bootstrap] System Node.js ${process.version} is older than Hardhat 3 supports (>= ${MIN_NODE.join(".")}).` +
      `\n[bootstrap] Installing project-local (not global, --no-save): ${wanted.join(", ")}\n`,
  );

  const result = spawnSync(
    "npm",
    ["install", "--no-save", "--no-audit", "--no-fund", "--loglevel=error", ...wanted],
    { cwd: root, stdio: "inherit", shell: true },
  );

  if (result.status !== 0) {
    console.warn(
      "\n[bootstrap] Could not provision a project-local Node.js 22. " +
        "Install Node.js >= 22.13 (nvm, fnm, Volta) and run `npm install` again.\n",
    );
    return;
  }

  console.log("\n[bootstrap] Done. `npm run <script>` and `npx hardhat` now use the project-local Node.js.\n");
}

main();
