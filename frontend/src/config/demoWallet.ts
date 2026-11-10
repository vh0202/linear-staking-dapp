import type { Wallet } from "@rainbow-me/rainbowkit";
import type { Address } from "viem";
import { createConnector } from "wagmi";
import { mock } from "wagmi/connectors";

// LOCAL DEMO ONLY.
//
// A wallet entry for the RainbowKit modal that needs no browser extension. It wraps wagmi's
// `mock` connector, which answers account requests itself and forwards everything else,
// including eth_sendTransaction, to the chain's RPC URL. The local Hardhat node signs
// transactions for its own built-in test accounts, so no private key ever reaches the
// browser. Against any real network the node would refuse to sign, which is why env.ts only
// enables this wallet on chain 31337.

const STORAGE_KEY = "linear-staking.demo-wallet.connected";

// The app's own mark (see components/icons.tsx), inlined: no image is fetched for it.
const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs>' +
      '<linearGradient id="g" x1="2" y1="4" x2="30" y2="28" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" stop-color="#7a5cff"/><stop offset="0.55" stop-color="#4f7bff"/><stop offset="1" stop-color="#2ed3e6"/>' +
      '</linearGradient></defs><rect width="32" height="32" fill="url(#g)"/>' +
      '<path d="M8.5 22.5h15" stroke="#fff" stroke-opacity="0.45" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M8.5 18.5 22 9.5" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>' +
      '<circle cx="22.5" cy="9.2" r="2.7" fill="#fff"/></svg>',
  );

const remember = (connected: boolean) => {
  try {
    if (connected) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); the wallet then simply does not reconnect.
  }
};

const remembered = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

export const demoWallet =
  (address: Address) =>
  (): Wallet => ({
    id: "local-demo",
    name: "Local Demo Wallet",
    iconUrl: ICON,
    iconBackground: "#4f7bff",
    installed: true,
    createConnector: (walletDetails) =>
      createConnector((config) => {
        const base = mock({ accounts: [address], features: { reconnect: true } })(config);
        return {
          ...base,
          ...walletDetails,
          async connect(parameters) {
            const result = await base.connect(parameters);
            remember(true);
            return result;
          },
          async disconnect() {
            await base.disconnect();
            remember(false);
          },
          // The mock connector would ask the node, which lists all of its accounts.
          async getAccounts() {
            return [address];
          },
          // Lets the page reconnect after a reload.
          async isAuthorized() {
            return remembered();
          },
        };
      }),
  });
