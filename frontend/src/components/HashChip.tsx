"use client";

import { useState } from "react";

import { chain } from "@/config/wagmi";
import { shortenAddress } from "@/lib/format";

import { CheckIcon, CopyIcon, ExternalIcon } from "./icons";

/**
 * A transaction hash or an address the way a block explorer shows it: monospace, shortened,
 * with a copy button, and a link to the explorer on chains that have one.
 */
export function HashChip({
  value,
  kind,
  lead = 10,
  tail = 8,
  shorterOnPhones = false,
}: {
  value: string;
  kind: "tx" | "address";
  lead?: number;
  tail?: number;
  /** In a tight row, show two characters fewer below the `sm` breakpoint. */
  shorterOnPhones?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const explorer = chain.blockExplorers?.default.url;
  const noun = kind === "tx" ? "transaction hash" : "address";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      // Clipboard access can be denied; the full value is still in the title.
    }
  };

  return (
    <span className="inline-flex max-w-full items-center gap-1 align-middle">
      <span title={value} className="truncate font-mono text-caption text-ink-2">
        {shorterOnPhones ? (
          <>
            <span className="sm:hidden">{shortenAddress(value, lead - 2, tail)}</span>
            <span className="max-sm:hidden">{shortenAddress(value, lead, tail)}</span>
          </>
        ) : (
          shortenAddress(value, lead, tail)
        )}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `Copied the ${noun}` : `Copy the ${noun}`}
        title={copied ? "Copied" : `Copy the ${noun}`}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-xs text-ink-3 transition-colors duration-150 hover:bg-raised hover:text-ink"
      >
        {copied ? <CheckIcon className="h-3.5 w-3.5 text-success" /> : <CopyIcon className="h-3.5 w-3.5" />}
      </button>
      {explorer !== undefined && (
        <a
          href={`${explorer}/${kind}/${value}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open the ${noun} in the block explorer`}
          title="Open in the block explorer"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-xs text-ink-3 transition-colors duration-150 hover:bg-raised hover:text-ink"
        >
          <ExternalIcon className="h-3.5 w-3.5" />
        </a>
      )}
    </span>
  );
}
