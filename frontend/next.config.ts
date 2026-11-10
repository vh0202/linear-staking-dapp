import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` prints http://localhost:3104, but the local node and the docs use
  // 127.0.0.1. Allow both, otherwise the dev server refuses to serve its own scripts to a
  // page opened through the IP address and the app never loads.
  allowedDevOrigins: ["127.0.0.1"],
  // Do not let `next dev` write an AGENTS.md file into the project.
  agentRules: false,
  turbopack: {
    // The repository has a second lockfile one level up (the Hardhat workspace). Pin the
    // root so the build only ever looks at this folder.
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
