// End-to-end check of the front end against the local Hardhat node, in a real Chrome
// (Playwright, "chrome" channel, no browser download and no wallet extension).
//
// It connects through the RainbowKit modal with the LOCAL-DEMO-ONLY wallet, then walks
// through approve -> stake -> rewards accruing -> claim -> unstake (partial and MAX) -> exit,
// asserting what the page shows at every step. On the way it also checks the interface
// itself: both themes and their persistence, no horizontal overflow at 1440, 1024 and 390 px,
// keyboard reachability with a visible focus, reduced motion, the paused-pool and
// period-ended states, and WCAG A/AA with axe-core. It saves eight screenshots to
// docs/screenshots/.
//
// Preconditions: `npx hardhat node` is running with a FRESH `npm run deploy:local`, and
// the front end is served on port 3104 (`npm run build && npm run start`). The repository
// root has one command that sets all of this up and tears it down: `npm run demo:e2e`.

import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.E2E_APP_URL ?? "http://127.0.0.1:3104/";
const RPC_URL = process.env.E2E_RPC_URL ?? "http://127.0.0.1:8545";
// E2E_SCREENSHOT_DIR redirects the screenshots, e.g. when checking the dev server, whose
// pages carry the Next.js dev badge and should not replace the ones in docs/.
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR ?? path.resolve(here, "../../docs/screenshots");
const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };
const PHONE = { width: 390, height: 844 };
const BLOCK_INTERVAL_MS = 2_000;
const HONESTY_LABEL = "Sample project — self-initiated portfolio demo, not client work. Not audited. Test tokens only.";
// Function selectors of the pool's owner-only pause() and unpause(), and of stake(uint256).
const PAUSE = "0x8456cb59";
const UNPAUSE = "0x3f4ba83a";
const STAKE_SELECTOR = "a694fc3a";

const AXE_SOURCE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

let rpcId = 0;
/** Development-only JSON-RPC calls (mining control, time travel) on the local node. */
async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const { result, error } = await response.json();
  if (error) throw new Error(`${method} failed: ${error.message}`);
  return result;
}

const toNumber = (text) => Number(text.replace(/,/g, ""));
const step = (message) => console.log(`  - ${message}`);

async function main() {
  assert.equal(await rpc("eth_chainId"), "0x7a69", "the RPC endpoint must be the local Hardhat node (chain 31337)");
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  // Written by scripts/deploy-local.ts: where the pool is and which test account owns it.
  const deployment = JSON.parse(await readFile(path.resolve(here, "../../deployments/localhost.json"), "utf8"));

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  // The operating system prefers dark and nothing is stored yet: the page must start dark.
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1, colorScheme: "dark" });
  const page = await context.newPage();

  const problems = [];
  const externalOrigins = new Set();
  const watch = (target) => {
    target.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
    target.on("console", (message) => {
      if (message.type() === "error") problems.push(`console error: ${message.text()}`);
    });
    target.on("request", (request) => {
      const { hostname, origin, protocol } = new URL(request.url());
      if (protocol.startsWith("http") && hostname !== "127.0.0.1" && hostname !== "localhost") {
        externalOrigins.add(origin);
      }
    });
  };
  watch(page);

  /** Numbers count to a new value; this waits until every one of them has arrived. */
  const settled = () =>
    page.waitForFunction(() => document.querySelector("[data-animating]") === null, undefined, { timeout: 20_000 });
  const text = async (testId) => {
    await settled();
    return page.getByTestId(testId).innerText();
  };
  const shot = async (name) => {
    // Park the pointer on empty space, let counting numbers arrive and transitions finish.
    const { width, height } = page.viewportSize();
    await page.mouse.move(width / 2, height - 6);
    await settled();
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, name) });
    step(`saved ${path.relative(process.cwd(), path.join(SCREENSHOT_DIR, name))}`);
  };
  const waitForText = (testId, expected) =>
    page.waitForFunction(
      ([id, value]) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() === value,
      [testId, expected],
      { timeout: 20_000 },
    );
  const waitForPhase = (testId, phase) =>
    page.locator(`[data-testid="${testId}"][data-phase="${phase}"]`).waitFor({ timeout: 20_000 });
  /** Opens one of the three tabs of the action panel, like a user would. */
  const openTab = async (name) => {
    await page.getByTestId(`tab-${name}`).click();
    assert.equal(await page.getByTestId(`tab-${name}`).getAttribute("aria-selected"), "true");
    await page.locator(`#panel-${name}`).waitFor({ state: "visible" });
  };
  const stepStates = () =>
    page.getByTestId("stake-steps").locator("li[data-state]").evaluateAll((items) => items.map((item) => item.dataset.state));
  const latestActivity = async () => {
    const item = page.getByTestId("activity-item").first();
    return { kind: await item.getAttribute("data-kind"), text: (await item.innerText()).replace(/\s+/g, " ") };
  };
  const toastTitles = () => page.getByTestId("toast-title").allInnerTexts();
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const setTheme = async (wanted) => {
    if ((await theme()) !== wanted) await page.getByTestId("theme-toggle").click();
    assert.equal(await theme(), wanted);
    await page.waitForTimeout(400); // the colours cross-fade
  };
  const assertNoHorizontalOverflow = async (label) => {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.ok(scrollWidth <= clientWidth, `horizontal overflow at ${label}: content is ${scrollWidth}px wide, viewport ${clientWidth}px`);
  };
  /** WCAG 2.1 A and AA with axe-core, injected from node_modules (no network request). */
  const assertAccessible = async (label) => {
    await settled();
    if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: AXE_SOURCE });
    // axe cannot measure text contrast on top of a gradient. The glows and the highlight on
    // the cards are decorative, so they are switched off while it measures; what they do to
    // contrast at their strongest point is checked by src/app/tokens.test.ts instead.
    const flat = await page.addStyleTag({ content: "*, *::before, *::after { background-image: none !important; }" });
    const { violations, incomplete } = await page.evaluate(() =>
      window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        resultTypes: ["violations", "incomplete"],
      }),
    );
    await flat.evaluate((style) => style.remove());

    // One finding is RainbowKit's own and is listed in the README: its dialog draws the wallet
    // icons as role="img" without a text alternative (the wallet's name is the text next to
    // it). Exactly that, on exactly those elements, is reported instead of failing the run.
    const isRainbowKitIcon = ({ id, nodes }) =>
      id === "role-img-alt" && nodes.every((node) => node.target.join(" ").includes('[data-testid="rk-wallet-option-'));
    const thirdParty = violations.filter(isRainbowKitIcon);
    const found = violations
      .filter((violation) => !isRainbowKitIcon(violation))
      .map(({ id, nodes }) => `${id}: ${nodes.map((node) => `${node.target.join(" ")} (${node.failureSummary})`).join("; ")}`);
    assert.deepEqual(found, [], `axe found WCAG A/AA violations (${label})`);

    const undecided = incomplete.flatMap(({ id, nodes }) => nodes.map((node) => `${id} on ${node.target.at(-1)}`));
    const notes = [
      thirdParty.length > 0 && `known RainbowKit finding: role-img-alt on ${thirdParty[0].nodes.length} wallet icons`,
      undecided.length > 0 && `could not decide ${undecided.length}: ${undecided.join(", ")}`,
    ].filter(Boolean);
    step(`axe-core, WCAG 2.1 A/AA (${label}): 0 violations in the app${notes.length > 0 ? `; ${notes.join("; ")}` : ""}`);
  };

  try {
    // ---------------------------------------------------------------- pool, no wallet
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    assert.equal(await theme(), "dark", "without a stored choice the page follows the operating system (dark)");
    await waitForText("pool-total-staked", "4,000");
    assert.equal(await text("pool-reward-rate"), "10,000");
    assert.equal(await text("pool-reward-reserve"), "70,000");
    assert.equal(await text("pool-reward-per-token"), "2.5", "10,000 RWD a day over 4,000 staked STK");
    assert.match(await text("pool-period-end"), /^6d 23h \d\dm$/);
    assert.match(await text("pool-period-elapsed"), /^(<0\.1|0\.\d)% elapsed$/, "progress since the RewardsFunded event");
    await page.getByTestId("connect-prompt").waitFor();
    assert.equal(await page.getByTestId("wallet-balance").count(), 0, "no balance is shown without a wallet");
    assert.equal(await text("honesty-label"), HONESTY_LABEL);
    assert.ok(await page.getByTestId("stake-submit").isDisabled(), "stake is disabled without a wallet");
    assert.equal(await text("stake-submit"), "Connect a wallet to stake", "a disabled button says why");
    assert.equal(await text("demo-wallet-indicator"), "Local demo wallet enabled");
    assert.ok(await page.getByTestId("demo-wallet-indicator").isVisible(), "the demo-wallet indicator is on screen");
    await assertNoHorizontalOverflow("1440 px, no wallet");
    step("pool data is shown before any wallet is connected");

    // A visitor whose operating system prefers light gets the light theme, unasked.
    const lightContext = await browser.newContext({ viewport: DESKTOP, colorScheme: "light" });
    const lightPage = await lightContext.newPage();
    await lightPage.goto(APP_URL, { waitUntil: "domcontentloaded" });
    assert.equal(await lightPage.evaluate(() => document.documentElement.dataset.theme), "light");
    await lightContext.close();

    // ---------------------------------------------------------------- connect
    await page.getByTestId("connect-wallet").click();
    const demoWallet = page.getByRole("button", { name: "Local Demo Wallet" });
    await demoWallet.waitFor();
    await page.waitForTimeout(600); // let the modal's open animation finish
    await shot("01-connect-wallet.png");
    await assertAccessible("wallet dialog, dark");

    await demoWallet.click();
    await waitForText("wallet-balance", "10,000");
    assert.equal(await text("staked-balance"), "0");
    assert.equal(await text("pending-rewards"), "0.000000");
    assert.equal((await text("wallet-account")).trim(), "0x7099…79C8", "the header shows the connected account");
    assert.equal(await page.getByTestId("connect-prompt").count(), 0);
    await openTab("claim");
    assert.ok(await page.getByTestId("claim-submit").isDisabled(), "claim is disabled while nothing is pending");
    assert.equal(await text("claim-submit"), "Nothing to claim yet");
    assert.ok(await page.getByTestId("exit-submit").isDisabled(), "exit is disabled without a stake");
    await openTab("stake");
    assert.match(await text("activity-empty"), /^No activity yet/);
    await page.waitForTimeout(600); // modal close animation
    await shot("02-connected-balances.png");

    // ---------------------------------------------------------------- keyboard
    // Everything is reachable with Tab, in reading order, and shows where the focus is.
    await page.locator("body").click({ position: { x: 4, y: 4 } });
    const stops = [];
    for (let presses = 0; presses < 14; presses++) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(() => {
          const element = document.activeElement;
          const style = getComputedStyle(element);
          // A button or a tab gets an outline; the amount input lights up the field around it.
          const field = element.closest(".focus-within\\:shadow-glow");
          const outlined = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
          const ringed = field !== null && getComputedStyle(field).boxShadow !== "none";
          return {
            id: element.getAttribute("data-testid") ?? element.getAttribute("aria-label") ?? element.tagName,
            visible: outlined || ringed,
          };
        }),
      );
    }
    // After the last control the focus leaves the document (BODY) and starts over. Under
    // `next dev` the framework's own dev-tools button is a stop too; it is not part of the app.
    const controls = stops.filter(({ id }) => id !== "BODY" && id !== "NEXTJS-PORTAL");
    const reached = [...new Set(controls.map(({ id }) => id))];
    for (const id of ["theme-toggle", "wallet-account", "tab-stake", "stake-amount", "stake-amount-max"]) {
      assert.ok(reached.includes(id), `"${id}" is reachable with the Tab key (reached: ${reached.join(", ")})`);
    }
    assert.deepEqual(controls.filter(({ visible }) => !visible), [], "every focused control shows a focus indicator");
    await page.getByTestId("tab-stake").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.getByTestId("tab-unstake").getAttribute("aria-selected"), "true", "arrow keys switch tabs");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("data-testid")), "tab-unstake");
    await page.keyboard.press("Home");
    assert.equal(await page.getByTestId("tab-stake").getAttribute("aria-selected"), "true");
    step(`keyboard: ${reached.length} controls reached with Tab, all with a visible focus; arrow keys switch tabs`);

    // ---------------------------------------------------------------- input validation
    const stakeInput = page.getByTestId("stake-amount");
    const stakeButton = page.getByTestId("stake-submit");
    for (const [typed, message, reason] of [
      ["abc", "Enter a number, for example 12.5", "Enter a valid amount"],
      ["0", "Enter an amount greater than zero", "Enter an amount"],
      ["10000.5", "You only have 10,000 STK in your wallet", "Not enough STK"],
      ["1.0000000000000000001", "This token has at most 18 decimals", "Too many decimals"],
    ]) {
      await stakeInput.fill(typed);
      assert.equal(await text("stake-amount-message"), message);
      assert.ok(await stakeButton.isDisabled(), `stake is disabled for "${typed}"`);
      assert.equal(await stakeButton.innerText(), reason, `the disabled button says why for "${typed}"`);
    }
    step("invalid amounts are rejected with a message and a disabled button that says why");

    // ---------------------------------------------------------------- approve, then stake
    await stakeInput.fill("1000");
    assert.equal(await text("stake-amount-message"), "");
    assert.equal(await stakeButton.innerText(), "Approve STK");
    assert.deepEqual(await stepStates(), ["current", "todo"], "step 1 needs approval, step 2 waits");
    assert.match(
      (await text("preview")).replace(/\s+/g, " "),
      /Share of the pool 0\.00% → 20\.00%/,
      "the form previews the position after the stake",
    );
    await stakeButton.click();
    await waitForPhase("stake-status", "confirmed");
    assert.match(await text("stake-status"), /^Approve STK confirmed in block \d+/);
    assert.equal(await stakeButton.innerText(), "Stake", "after the approval the same button stakes");
    assert.deepEqual(await stepStates(), ["done", "current"], "step 1 is done, step 2 is ready");
    assert.deepEqual(await toastTitles(), ["Approve STK confirmed"], "a confirmation raises a toast");
    step("approval confirmed, the button switched from Approve to Stake");

    // Hold blocks back so the pending state stays on screen long enough to capture.
    await rpc("evm_setIntervalMining", [0]);
    await rpc("evm_setAutomine", [false]);
    await stakeButton.click();
    await waitForPhase("stake-status", "pending");
    assert.match(await text("stake-status"), /^Stake pending, waiting for a block\s+0x[0-9a-f]{8}…[0-9a-f]{8}$/);
    assert.ok(await stakeButton.isDisabled(), "no second submit while a transaction is pending");
    assert.deepEqual(await stepStates(), ["done", "pending"]);
    assert.equal(await text("staked-balance"), "0", "nothing is staked until the transaction is mined");
    await shot("03-stake-pending.png");

    await rpc("evm_setAutomine", [true]);
    await rpc("evm_mine");
    await rpc("evm_setIntervalMining", [BLOCK_INTERVAL_MS]);
    await waitForPhase("stake-status", "confirmed");
    await waitForText("staked-balance", "1,000");
    assert.equal(await text("wallet-balance"), "9,000");
    assert.equal(await text("pool-total-staked"), "5,000");
    assert.equal(await text("pool-share"), "20.00%");
    assert.equal(await text("pool-reward-per-token"), "2", "10,000 RWD a day over 5,000 staked STK");
    assert.equal(await stakeInput.inputValue(), "", "the input is cleared after a successful stake");
    assert.deepEqual(await stepStates(), ["done", "done"]);
    const stakedEvent = await latestActivity();
    assert.equal(stakedEvent.kind, "staked");
    assert.match(stakedEvent.text, /^Staked 1,000 STK Block \d+/, "the Staked event is listed");
    step("stake confirmed: 1,000 STK staked, 20.00% of the pool, listed under recent activity");

    // ---------------------------------------------------------------- rewards accrue
    // Six hours later: 20% of 10,000 RWD/day for a quarter of a day = 500 RWD.
    await rpc("evm_increaseTime", [6 * 60 * 60]);
    await rpc("evm_mine");
    await page.waitForFunction(
      () => Number(document.querySelector('[data-testid="pending-rewards"]')?.textContent?.replace(/,/g, "")) >= 500,
      undefined,
      { timeout: 20_000 },
    );
    const earlier = toNumber(await text("pending-rewards"));
    await page.waitForTimeout(1_500);
    const later = toNumber(await text("pending-rewards"));
    assert.ok(earlier >= 500 && earlier < 501, `about 500 RWD after six hours, got ${earlier}`);
    assert.ok(later > earlier, `pending rewards tick up on their own (${earlier} -> ${later})`);
    assert.ok(await page.getByTestId("claim-submit").isEnabled(), "claim is enabled once rewards are pending");
    assert.match(await text("pool-period-end"), /^6d 17h \d\dm$/);
    assert.match(await text("pool-period-elapsed"), /^3\.[5-9]% elapsed$/, "six of 168 hours");
    assert.match(await text("reward-pace"), /^\+2,000 RWD per day/);
    assert.equal(await text("position-status"), "Earning rewards");

    // Between two blocks the number moves on every frame and never backwards.
    const frames = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const seen = [];
          const started = performance.now();
          const read = () => {
            seen.push(Number(document.querySelector('[data-testid="pending-rewards"]').textContent.replace(/,/g, "")));
            if (performance.now() - started < 4_500) requestAnimationFrame(read);
            else resolve(seen);
          };
          requestAnimationFrame(read);
        }),
    );
    const distinct = new Set(frames).size;
    const backwards = frames.filter((value, index) => index > 0 && value < frames[index - 1]).length;
    assert.equal(backwards, 0, "the ticker never runs backwards across blocks");
    assert.ok(distinct > 60, `the ticker moves smoothly: ${distinct} different values in 4.5 s`);
    step(`rewards accrue live: ${earlier} -> ${later} RWD; ${distinct} values in 4.5 s across two blocks, none backwards`);

    // The claim tab shows the same live figure next to the button that pays it out.
    await openTab("claim");
    assert.equal(await text("claim-submit"), "Claim rewards");
    const [inHero, inTab] = await page.evaluate(() =>
      ["pending-rewards", "rewards-claimable"].map((id) => document.querySelector(`[data-testid="${id}"]`).textContent),
    );
    assert.equal(inTab, inHero, "both places print the same live value in the same frame");
    await page.getByTestId("toast").first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    await shot("04-rewards-accruing.png");

    // ---------------------------------------------------------------- themes, widths, motion
    await assertAccessible("dark, 1440 px");
    await setTheme("light");
    await shot("07-rewards-accruing-light.png");
    await assertAccessible("light, 1440 px");

    // The choice is stored and applied before the app's scripts run: no flash on load.
    const second = await context.newPage();
    watch(second);
    await second.goto(APP_URL, { waitUntil: "domcontentloaded" });
    const onLoad = await second.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      stored: window.localStorage.getItem("linear-staking.theme"),
      background: getComputedStyle(document.body).backgroundColor,
    }));
    assert.deepEqual(onLoad, { theme: "light", stored: "light", background: "rgb(244, 245, 249)" });
    await second.close();
    step("light theme: stored, and applied on load before the app starts");

    for (const viewport of [TABLET, PHONE]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(300);
      await assertNoHorizontalOverflow(`${viewport.width} px, light`);
    }
    await setTheme("dark");
    await assertNoHorizontalOverflow("390 px, dark");
    assert.ok(await page.getByTestId("demo-wallet-indicator").isVisible(), "the demo-wallet indicator stays visible on a phone");
    await assertAccessible("dark, 390 px");
    // One image of the whole page: a viewport as tall as the page itself.
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: PHONE.width, height: pageHeight });
    await shot("08-rewards-accruing-390.png");
    await page.setViewportSize(TABLET);
    await page.waitForTimeout(300);
    await assertNoHorizontalOverflow("1024 px, dark");
    await page.setViewportSize(DESKTOP);
    await page.waitForTimeout(300);
    await assertNoHorizontalOverflow("1440 px, dark");
    step("no horizontal overflow at 1440, 1024 and 390 px, in both themes");

    // prefers-reduced-motion: animations stop and the ticker is refreshed once a second.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const calm = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const seen = new Set();
          const started = performance.now();
          const read = () => {
            seen.add(document.querySelector('[data-testid="pending-rewards"]').textContent);
            if (performance.now() - started < 2_500) requestAnimationFrame(read);
            else {
              const dot = document.querySelector(".animate-live");
              resolve({ values: seen.size, animation: parseFloat(getComputedStyle(dot).animationDuration) });
            }
          };
          requestAnimationFrame(read);
        }),
    );
    assert.ok(calm.values >= 2 && calm.values <= 5, `reduced motion: the ticker steps once a second (${calm.values} values in 2.5 s)`);
    assert.ok(calm.animation < 0.001, "reduced motion: CSS animations are switched off");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    step(`reduced motion: animations off, ticker refreshed ${calm.values} times in 2.5 s instead of every frame`);

    // ---------------------------------------------------------------- claim
    await openTab("claim");
    await page.getByTestId("claim-submit").click();
    await waitForPhase("rewards-status", "confirmed");
    assert.match(await text("rewards-status"), /^Claim confirmed in block \d+/);
    const claimedText = await text("wallet-reward-balance");
    const claimed = toNumber(claimedText);
    assert.ok(claimed >= 500 && claimed < 501, `about 500 RWD arrived in the wallet, got ${claimed}`);
    assert.ok(toNumber(await text("pending-rewards")) < 1, "pending rewards restart from zero after a claim");
    assert.equal(await text("staked-balance"), "1,000", "claiming does not touch the stake");
    assert.match((await latestActivity()).text, new RegExp(`^Claimed ${claimedText.replace(".", "\\.")} RWD Block \\d+`));
    assert.ok((await toastTitles()).includes("Claim confirmed"), "the claim raises a toast");
    await shot("05-claim-confirmed.png");
    step(`claim confirmed: ${claimed} RWD in the wallet, listed under recent activity`);

    // ---------------------------------------------------------------- unstake: partial
    await openTab("unstake");
    const unstakeInput = page.getByTestId("unstake-amount");
    await unstakeInput.fill("1000.01");
    assert.equal(await text("unstake-amount-message"), "You only have 1,000 STK staked");
    assert.ok(await page.getByTestId("unstake-submit").isDisabled());

    await unstakeInput.fill("400");
    await page.getByTestId("unstake-submit").click();
    await waitForPhase("unstake-status", "confirmed");
    await waitForText("staked-balance", "600");
    assert.equal(await text("wallet-balance"), "9,400");
    assert.equal(await text("pool-total-staked"), "4,600");
    assert.match((await latestActivity()).text, /^Unstaked 400 STK Block \d+/);
    assert.equal(await page.getByTestId("activity-item").count(), 3, "stake, claim and unstake are all listed");
    await shot("06-unstake-confirmed.png");
    step("partial unstake confirmed: 400 STK back in the wallet, 600 STK still staked");

    // ---------------------------------------------------------------- unstake: MAX
    await page.getByTestId("unstake-amount-max").click();
    assert.equal(await unstakeInput.inputValue(), "600");
    await page.getByTestId("unstake-submit").click();
    await waitForText("staked-balance", "0");
    await waitForText("wallet-balance", "10,000");
    assert.ok(await page.getByTestId("exit-submit").isDisabled());
    assert.equal(await text("position-status"), "Nothing staked yet");
    step("MAX unstake confirmed: the whole stake is back in the wallet");

    // ---------------------------------------------------------------- stake again
    await openTab("stake");
    await stakeInput.fill("250");
    await stakeButton.click(); // approve
    await page.waitForFunction(
      () => document.querySelector('[data-testid="stake-submit"]')?.textContent?.trim() === "Stake",
      undefined,
      { timeout: 20_000 },
    );
    await stakeButton.click(); // stake
    await waitForText("staked-balance", "250");

    // ---------------------------------------------------------------- a failed transaction
    // The owner (the node's first test account; the node signs for it) pauses the pool at
    // the very moment the user stakes. To make that race repeatable the page's own reads are
    // held back, so it still shows an open pool; only the stake call itself gets through,
    // and the node rejects it when the page simulates it.
    await stakeInput.fill("50");
    await stakeButton.click(); // approve
    await page.waitForFunction(
      () => document.querySelector('[data-testid="stake-submit"]')?.textContent?.trim() === "Stake",
      undefined,
      { timeout: 20_000 },
    );
    const isNode = (url) => url.origin === new URL(RPC_URL).origin;
    const heldReads = [];
    await page.route(isNode, (route) => {
      if ((route.request().postData() ?? "").includes(STAKE_SELECTOR)) return route.continue();
      heldReads.push(route);
    });
    await rpc("eth_sendTransaction", [{ from: deployment.owner, to: deployment.staking, data: PAUSE }]);
    await stakeButton.click();
    await waitForPhase("stake-status", "failed");
    assert.match(
      (await text("stake-status")).replace(/\s+/g, " "),
      /^Stake failed\. The pool is paused: staking and claiming are disabled\. Unstaking still works\./,
      "a failure names its reason in plain words",
    );
    assert.deepEqual(await stepStates(), ["done", "failed"]);
    await page.unroute(isNode);
    for (const route of heldReads) await route.continue();
    assert.equal(await text("staked-balance"), "250", "nothing was sent");

    // ---------------------------------------------------------------- paused pool
    await page.getByTestId("paused-notice").waitFor({ timeout: 20_000 });
    assert.ok(await stakeInput.isDisabled(), "the stake form is closed while the pool is paused");
    assert.ok(await stakeButton.isDisabled(), "staking is disabled while the pool is paused");
    assert.equal(await stakeButton.innerText(), "Staking is paused");
    await openTab("claim");
    assert.ok(await page.getByTestId("claim-submit").isDisabled(), "claiming is disabled while the pool is paused");
    assert.equal(await text("claim-submit"), "Claiming is paused");
    assert.ok(await page.getByTestId("exit-submit").isDisabled(), "exit is disabled while the pool is paused");
    await openTab("unstake");
    await unstakeInput.fill("100");
    await page.getByTestId("unstake-submit").click();
    await waitForPhase("unstake-status", "confirmed");
    await waitForText("staked-balance", "150");
    await assertAccessible("paused pool");
    await rpc("eth_sendTransaction", [{ from: deployment.owner, to: deployment.staking, data: UNPAUSE }]);
    await page.getByTestId("paused-notice").waitFor({ state: "detached", timeout: 20_000 });
    step("paused pool: notice shown, stake / claim / exit disabled with the reason, unstake still works");

    // The failed stake is still on its tab, with its reason. Now that the pool is open
    // again, "Try again" sends it.
    await openTab("stake");
    await page.getByTestId("stake-status-retry").click();
    await waitForPhase("stake-status", "confirmed");
    await waitForText("staked-balance", "200");
    assert.equal(await stakeInput.inputValue(), "");
    step("failed transaction: reason shown in plain words, nothing sent; Try again succeeds once the pool is open");

    // ---------------------------------------------------------------- exit
    await openTab("claim");
    await page.getByTestId("exit-submit").click();
    await waitForPhase("rewards-status", "confirmed");
    assert.match(await text("rewards-status"), /^Exit confirmed in block \d+/);
    await waitForText("staked-balance", "0");
    await waitForText("wallet-balance", "10,000");
    step("exit confirmed: stake and rewards returned in one transaction");

    // ---------------------------------------------------------------- period ended
    await rpc("evm_increaseTime", [7 * 24 * 60 * 60]);
    await rpc("evm_mine");
    await page.getByTestId("period-ended").waitFor({ timeout: 20_000 });
    assert.equal(await text("pool-period-end"), "ended");
    assert.equal(await text("pool-reward-rate"), "0", "nothing is emitted after the period");
    assert.equal(await text("pool-period-elapsed"), "All rewards of this period have been emitted");
    step("period ended: notice shown, reward rate 0");

    assert.deepEqual(problems, [], "the page logged errors");
    assert.deepEqual([...externalOrigins], [], "the page contacted hosts other than the local node and itself");
    step("no page errors, no requests to external hosts");
  } catch (error) {
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "..", "e2e-failure.png") }).catch(() => {});
    if (problems.length > 0) console.error(`Page problems:\n${problems.join("\n")}`);
    throw error;
  } finally {
    // Leave the node mining normally and the pool unpaused, whatever happened.
    await rpc("evm_setAutomine", [true]).catch(() => {});
    await rpc("evm_setIntervalMining", [BLOCK_INTERVAL_MS]).catch(() => {});
    await browser.close();
  }
}

console.log(`E2E demo flow against ${APP_URL} (node ${RPC_URL})`);
await main();
console.log("E2E demo flow passed.");
