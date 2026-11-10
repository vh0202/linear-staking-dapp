"use client";

import dynamic from "next/dynamic";

import { AppShell } from "./AppShell";

// The wallet stack (wagmi, RainbowKit and the wallet SDKs they bundle) only makes sense in
// a browser, so it is loaded on the client only. The server renders the static shell below,
// which is also what a visitor sees until the app has loaded.
const App = dynamic(() => import("./App").then((module) => module.App), {
  ssr: false,
  loading: () => <AppShell />,
});

export function AppLoader() {
  return <App />;
}
