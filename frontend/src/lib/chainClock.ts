/**
 * Estimates the chain's clock from the blocks the page has seen, so that everything driven
 * by time (the rewards ticker, the countdown, the period progress) runs on chain time and
 * stays continuous from one block to the next.
 *
 * A block with timestamp T that the page first sees at local time S gives the observation
 * `T * 1000 - S`. Every observation is the true offset between the two clocks minus the
 * delay with which the block was seen (polling, network) and minus the part of a second the
 * timestamp was rounded down by. The largest of the recent observations is therefore the
 * best estimate: the block that was seen with the least delay.
 */
export type ClockObservation = {
  blockNumber: bigint;
  /** Block timestamp in ms minus the local time at which the block was first seen. */
  offsetMs: number;
};

/** How many recent blocks the estimate is taken from. */
export const CLOCK_WINDOW = 5;

/**
 * Adds the sighting of a block to the history and returns the new history.
 *
 * - The same block seen again changes nothing: only the first sighting counts.
 * - A lower block number means the chain was replaced (a local node restarted): start over.
 */
export function observeBlock(
  history: readonly ClockObservation[],
  blockNumber: bigint,
  blockTimestamp: bigint,
  seenAtMs: number,
): readonly ClockObservation[] {
  const observation = { blockNumber, offsetMs: Number(blockTimestamp) * 1000 - seenAtMs };
  const latest = history.at(-1);

  if (latest === undefined || blockNumber < latest.blockNumber) return [observation];
  if (blockNumber === latest.blockNumber) return history;
  return [...history, observation].slice(-CLOCK_WINDOW);
}

/** Estimated `chain clock - local clock` in ms. 0 before any block has been seen. */
export function clockOffsetMs(history: readonly ClockObservation[]): number {
  if (history.length === 0) return 0;
  return Math.max(...history.map(({ offsetMs }) => offsetMs));
}

/**
 * Milliseconds of chain time that have passed since the block with `blockTimestamp`, at
 * local time `nowMs`. Never negative: time does not run backwards between two reads.
 */
export function chainElapsedMs(blockTimestamp: bigint, offsetMs: number, nowMs: number): number {
  return Math.max(0, nowMs + offsetMs - Number(blockTimestamp) * 1000);
}
