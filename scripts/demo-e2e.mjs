// One command for the whole browser check, from nothing to nothing:
//
//   npm run demo:e2e
//
//   1. starts a fresh local Hardhat node            (port 8545)
//   2. deploys and seeds the demo                   (scripts/deploy-local.ts)
//   3. builds the front end against that deployment (frontend/.env.local)
//   4. serves the production build                  (port 3104)
//   5. drives it in headless Chrome and regenerates docs/screenshots/*.png
//      (frontend/e2e/demo-flow.mjs)
//   6. stops the node and the web server again, also when a step fails
//
// It refuses to start if either port is already in use, so it never touches a node or a
// server it did not start itself.

import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");
const NODE_PORT = 8545;
const WEB_PORT = 3104;
const isWindows = process.platform === "win32";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForPort(port, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portInUse(port)) return;
    await sleep(500);
  }
  throw new Error(`${label} did not start listening on port ${port} within ${timeoutMs / 1000}s`);
}

/** Starts a long-running process in its own process group, so the whole tree can be stopped. */
function startServer(command, args, cwd) {
  return spawn(command, args, { cwd, shell: true, stdio: "ignore", detached: !isWindows });
}

function stopServer(child) {
  if (child === undefined || child.pid === undefined || child.exitCode !== null) return;
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

function run(label, command, args, cwd) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { cwd, shell: true, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`"${label}" failed with exit code ${result.status}`);
}

let node;
let web;
let failed = false;

try {
  for (const port of [NODE_PORT, WEB_PORT]) {
    if (await portInUse(port)) {
      throw new Error(`Port ${port} is already in use. Stop whatever is listening there and run this again.`);
    }
  }

  console.log(`> Starting a local Hardhat node on port ${NODE_PORT}`);
  node = startServer("npx", ["hardhat", "node"], root);
  await waitForPort(NODE_PORT, "The Hardhat node");

  run("Deploying and seeding the demo", "npx", ["hardhat", "run", "scripts/deploy-local.ts", "--network", "localhost"], root);
  run("Building the front end", "npm", ["run", "build"], frontend);

  console.log(`\n> Serving the front end on port ${WEB_PORT}`);
  web = startServer("npm", ["run", "start"], frontend);
  await waitForPort(WEB_PORT, "The front end");

  run("Driving the demo flow in headless Chrome", "node", ["e2e/demo-flow.mjs"], frontend);
} catch (error) {
  failed = true;
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
} finally {
  stopServer(web);
  stopServer(node);
  // Give the operating system a moment to release the ports before reporting.
  await sleep(1_500);
  const leftovers = [];
  for (const port of [NODE_PORT, WEB_PORT]) if (await portInUse(port)) leftovers.push(port);
  console.log(
    leftovers.length === 0
      ? "\nStopped the node and the web server; ports 8545 and 3104 are free again."
      : `\nWARNING: something is still listening on port(s) ${leftovers.join(", ")}.`,
  );
}

process.exit(failed ? 1 : 0);
