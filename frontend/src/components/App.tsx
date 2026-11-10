"use client";

import { Dashboard } from "./Dashboard";
import { Providers } from "./Providers";

export function App() {
  return (
    <Providers>
      <Dashboard />
    </Providers>
  );
}
