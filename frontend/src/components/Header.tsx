"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

import { appConfig } from "@/config/env";
import { chain } from "@/config/wagmi";
import { useTheme } from "@/hooks/useLive";
import { shortenAddress } from "@/lib/format";

import { AlertIcon, ChevronDownIcon, FlaskIcon, MoonIcon, SunIcon, WalletIcon } from "./icons";
import { cx, LiveDot, Pill } from "./ui";

/** What the header says about the connection to the chain. "idle": nothing has been read yet. */
export type NetworkStatus = "idle" | "live" | "offline" | "wrong-network";

/**
 * Shown only when the build was made with the local demo wallet enabled. It stays visible
 * at every width: a visitor must be able to tell that this is not a real wallet.
 */
function DemoWalletPill() {
  if (appConfig.demoWalletAddress === undefined) return null;
  return (
    <Pill
      tone="warning"
      testId="demo-wallet-indicator"
      title="A built-in Hardhat test account is offered as a wallet. Local demo only."
    >
      <FlaskIcon className="h-3.5 w-3.5" />
      Local demo wallet enabled
    </Pill>
  );
}

function NetworkPill({ status }: { status: NetworkStatus }) {
  if (status === "wrong-network") {
    return (
      <Pill tone="warning" testId="network-name" title={`This page talks to ${chain.name}.`}>
        <AlertIcon className="h-3.5 w-3.5" />
        Wrong network
      </Pill>
    );
  }
  if (status === "offline") {
    return (
      <Pill tone="warning" testId="network-name" title="The RPC endpoint is not answering.">
        <LiveDot tone="warning" live={false} />
        {chain.name} unreachable
      </Pill>
    );
  }
  if (status === "idle") {
    return (
      <Pill testId="network-name" title={`This page talks to ${chain.name} (chain ${chain.id})`}>
        <LiveDot tone="neutral" live={false} />
        {chain.name}
      </Pill>
    );
  }
  return (
    <Pill testId="network-name" title={`Reading ${chain.name} (chain ${chain.id})`}>
      <LiveDot />
      {chain.name}
    </Pill>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to the ${next} theme`}
      title={`Switch to the ${next} theme`}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-2 transition-colors duration-150 ease-standard hover:border-line-strong hover:text-ink"
    >
      {theme === "dark" ? <SunIcon className="h-[1.125rem] w-[1.125rem]" /> : <MoonIcon className="h-[1.125rem] w-[1.125rem]" />}
    </button>
  );
}

const walletButtonBase =
  "inline-flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-body font-semibold sm:px-3.5 " +
  "transition-[filter,background-color,border-color] duration-150 ease-standard active:scale-[0.985]";

/** The wallet button, drawn with the app's own tokens; RainbowKit provides the dialogs. */
function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, mounted, openAccountModal, openConnectModal }) => {
        if (!mounted || account === undefined) {
          return (
            <button
              type="button"
              data-testid="connect-wallet"
              onClick={openConnectModal}
              disabled={!mounted}
              className={cx(walletButtonBase, "bg-cta text-on-accent shadow-cta hover:brightness-110")}
            >
              <WalletIcon className="h-4 w-4" />
              <span>
                Connect<span className="max-sm:sr-only"> wallet</span>
              </span>
            </button>
          );
        }
        return (
          <button
            type="button"
            data-testid="wallet-account"
            onClick={openAccountModal}
            title={`Connected as ${account.address}. Open the account details.`}
            className={cx(
              walletButtonBase,
              "border border-line bg-surface text-ink hover:border-line-strong hover:bg-raised",
            )}
          >
            <span aria-hidden="true" className="h-5 w-5 rounded-full bg-signature max-sm:hidden" />
            <span className="font-mono font-medium">{shortenAddress(account.address)}</span>
            <ChevronDownIcon className="h-4 w-4 text-ink-3 max-sm:hidden" />
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

/** Theme and wallet: the right end of the header. */
export function HeaderControls() {
  return (
    <>
      <ThemeToggle />
      <WalletButton />
    </>
  );
}

/** Which network the page talks to, and whether the local demo wallet is on offer. */
export function HeaderStatus({ network }: { network: NetworkStatus }) {
  return (
    <>
      <DemoWalletPill />
      <NetworkPill status={network} />
    </>
  );
}
