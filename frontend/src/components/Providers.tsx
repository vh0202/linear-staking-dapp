"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { darkTheme, RainbowKitProvider, type Theme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import { wagmiConfig } from "@/config/wagmi";

// RainbowKit's dialogs are themed with the app's own design tokens (src/app/tokens.css):
// every value below is a reference to a custom property, so the dialogs follow the theme
// switch by themselves and there is still only one place where a colour is defined.
const base = darkTheme({ borderRadius: "medium", overlayBlur: "small" });

const rainbowTheme: Theme = {
  ...base,
  blurs: { modalOverlay: "blur(6px)" },
  fonts: { body: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" },
  radii: {
    actionButton: "var(--radius-md)",
    connectButton: "var(--radius-md)",
    menuButton: "var(--radius-md)",
    modal: "var(--radius-xl)",
    modalMobile: "var(--radius-xl)",
  },
  shadows: {
    ...base.shadows,
    dialog: "var(--elevation-pop)",
    selectedOption: "none",
    selectedWallet: "none",
    walletLogo: "none",
  },
  colors: {
    ...base.colors,
    // RainbowKit uses one colour both for links on the dialog and behind button labels.
    // The accent text colour with the page background on top of it passes AA in both roles.
    accentColor: "var(--accent-text)",
    accentColorForeground: "var(--bg)",
    actionButtonBorder: "var(--line)",
    actionButtonBorderMobile: "var(--line)",
    actionButtonSecondaryBackground: "var(--surface-raised)",
    closeButton: "var(--text-secondary)",
    closeButtonBackground: "var(--surface-raised)",
    connectButtonBackground: "var(--surface)",
    connectButtonInnerBackground: "var(--surface-raised)",
    connectButtonText: "var(--text)",
    connectionIndicator: "var(--success)",
    error: "var(--danger)",
    generalBorder: "var(--line)",
    generalBorderDim: "var(--line)",
    menuItemBackground: "var(--surface-raised)",
    modalBackdrop: "var(--scrim)",
    modalBackground: "var(--surface)",
    modalBorder: "var(--line-strong)",
    modalText: "var(--text)",
    modalTextDim: "var(--text-tertiary)",
    modalTextSecondary: "var(--text-secondary)",
    profileAction: "var(--surface-raised)",
    profileActionHover: "var(--line)",
    profileForeground: "var(--surface)",
    selectedOptionBorder: "var(--accent-line)",
    standby: "var(--warning)",
  },
};

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rainbowTheme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
