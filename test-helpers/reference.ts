/**
 * Independent reference model of the staking pool, used to check the contract's results.
 *
 * It deliberately shares no technique with the contract:
 *   - no reward-per-token accumulator: for every interval in which stakes are constant it
 *     hands each staker `rate * dt * stake / totalStake` directly;
 *   - no fixed-point arithmetic: all amounts are exact fractions of BigInts, so the model
 *     has no rounding at all.
 *
 * The contract is expected to match the model up to its documented rounding (see
 * `payoutTolerance`).
 */

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/** Exact non-negative rational number. */
export class Fraction {
  static readonly ZERO = new Fraction(0n, 1n);

  readonly numerator: bigint;
  readonly denominator: bigint;

  constructor(numerator: bigint, denominator: bigint = 1n) {
    if (denominator <= 0n || numerator < 0n) throw new Error("Fraction: expected n >= 0 and d > 0");
    const divisor = gcd(numerator, denominator);
    this.numerator = numerator / divisor;
    this.denominator = denominator / divisor;
  }

  add(other: Fraction): Fraction {
    return new Fraction(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  mul(other: Fraction): Fraction {
    return new Fraction(this.numerator * other.numerator, this.denominator * other.denominator);
  }

  div(other: Fraction): Fraction {
    return new Fraction(this.numerator * other.denominator, this.denominator * other.numerator);
  }

  /** Largest integer <= this. */
  floor(): bigint {
    return this.numerator / this.denominator;
  }

  /** Smallest integer >= this. */
  ceil(): bigint {
    return (this.numerator + this.denominator - 1n) / this.denominator;
  }
}

const whole = (value: bigint) => new Fraction(value);

export class ReferencePool {
  /** Time up to which emissions have been handed out. */
  private time = 0n;
  /** Reward wei per second, exact. */
  private rate = Fraction.ZERO;
  private periodFinish = 0n;
  /** Emissions of seconds in which nobody was staked; added to the next funding. */
  private carry = Fraction.ZERO;
  private totalStaked = 0n;
  private readonly stakes = new Map<string, bigint>();
  private readonly owed = new Map<string, Fraction>();
  private readonly paid = new Map<string, Fraction>();

  /** Hands out everything emitted between the last call and `to`. Time only moves forward. */
  private advance(to: bigint): void {
    if (to < this.time) throw new Error("ReferencePool: time went backwards");
    const end = to < this.periodFinish ? to : this.periodFinish;
    if (end > this.time) {
      const emission = this.rate.mul(whole(end - this.time));
      if (this.totalStaked === 0n) {
        this.carry = this.carry.add(emission);
      } else {
        for (const [account, stake] of this.stakes) {
          if (stake === 0n) continue;
          const share = emission.mul(new Fraction(stake, this.totalStaked));
          this.owed.set(account, this.owedTo(account).add(share));
        }
      }
    }
    this.time = to;
  }

  private owedTo(account: string): Fraction {
    return this.owed.get(account) ?? Fraction.ZERO;
  }

  fund(time: bigint, amount: bigint, duration: bigint): void {
    this.advance(time);
    const leftover =
      time < this.periodFinish ? this.rate.mul(whole(this.periodFinish - time)) : Fraction.ZERO;
    this.rate = whole(amount).add(leftover).add(this.carry).div(whole(duration));
    this.carry = Fraction.ZERO;
    this.periodFinish = time + duration;
  }

  stake(time: bigint, account: string, amount: bigint): void {
    this.advance(time);
    this.stakes.set(account, this.stakeOf(account) + amount);
    this.totalStaked += amount;
  }

  unstake(time: bigint, account: string, amount: bigint): void {
    this.advance(time);
    const stake = this.stakeOf(account);
    if (amount > stake) throw new Error("ReferencePool: unstake exceeds stake");
    this.stakes.set(account, stake - amount);
    this.totalStaked -= amount;
  }

  /** Pays out everything owed to `account` and returns the exact amount. */
  claim(time: bigint, account: string): Fraction {
    this.advance(time);
    const amount = this.owedTo(account);
    this.owed.set(account, Fraction.ZERO);
    this.paid.set(account, this.paidTo(account).add(amount));
    return amount;
  }

  /** Rewards owed to `account` at `time`, exact. */
  earned(time: bigint, account: string): Fraction {
    this.advance(time);
    return this.owedTo(account);
  }

  stakeOf(account: string): bigint {
    return this.stakes.get(account) ?? 0n;
  }

  paidTo(account: string): Fraction {
    return this.paid.get(account) ?? Fraction.ZERO;
  }

  /** Everything `account` has been paid plus everything it is still owed at `time`. */
  lifetimeRewards(time: bigint, account: string): Fraction {
    return this.paidTo(account).add(this.earned(time, account));
  }
}

/**
 * Stated rounding tolerance between the contract and the exact model, in reward-token wei.
 *
 * The contract rounds an account's rewards down by less than 1 wei every time that account
 * is settled (any stake, unstake, claim or exit by the account). Two further wei cover the
 * rounding of the final read and the sub-wei remainder of the reward-rate division, which
 * the contract carries into the next period instead of emitting it. Truncation inside the
 * accumulator itself is below 1e-12 wei for the amounts used in these tests.
 */
export function payoutTolerance(settlements: number): bigint {
  return BigInt(settlements) + 2n;
}
