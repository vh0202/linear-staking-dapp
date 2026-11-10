import { chain } from "@/config/wagmi";

import { LiveDot } from "./ui";

/** Right side of the footer bar: which chain, and the block the numbers were read at. */
export function FooterStatus({ blockNumber, stale }: { blockNumber: bigint | undefined; stale: boolean }) {
  return (
    <p className="flex items-center gap-2 text-ink-3">
      <span>
        {chain.name} <span className="hidden sm:inline">(chain {chain.id})</span>
      </span>
      {blockNumber !== undefined && (
        <>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5" title="The block every figure on this page was read at">
            <LiveDot tone={stale ? "warning" : "success"} live={!stale} />
            <span>
              Block <span data-testid="block-number">{blockNumber.toString()}</span>
            </span>
          </span>
        </>
      )}
    </p>
  );
}
