// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol in the snapshot that records no token (342 of them), in two
// tiers. The launch tier holds the protocols that could still launch a token of their own: no
// token on record, not a centralised exchange, not a versioned pool of another protocol, and not
// a wrapped, staked or bridged copy. The copy tier holds the rest — wrapped, staked and bridged
// products of tokens that already trade — ranked at the bottom, because a copy is not a launch of
// its own. The watchlist (40 slugs) is the floor: every one of them is in the launch tier, and
// the early radar adds every other launch-tier protocol below the floor, by TVL. Nothing is
// hand-picked and no protocol name is ever special-cased: the same functions score every row.
//
// Implied value follows only from the snapshot's own figures:
//
//   base         = tvl_usd x BASE_MULTIPLE
//   growth       = clamp(change_7d, -80, 200) per cent (null counts as 0)
//   growthMult   = 1 + (growth / 100) x GROWTH_WEIGHT_UP    when growth >= 0
//                = 1 + (growth / 100) x GROWTH_WEIGHT_DOWN  when growth < 0
//                  (a shrinking TVL hurts more than a growing one helps)
//   maturity     = 0.6 + 0.4 x ln(1 + min(age_days, 1095)) / ln(1 + 1095)
//                  (age_days unknown: 365; the curve rises fast, then plateaus —
//                   a protocol that has run two years with no token is nearly as
//                   mature as one that has run three)
//   implied      = max(1, round(base x growthMult x maturity))
//
// A copy's implied value is the same formula at a 2% weight, rescaled so the largest copy
// stays below the smallest launch: copies are measured on the same ruler, then put where they
// belong. The dashboard states the formula and recomputes every row from the snapshot figures,
// so the page's code and the board's data are visibly the same arithmetic.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight_up: number;
  growth_weight_down: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  copy_weight: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight_up: 0.8,
  growth_weight_down: 1.2,
  growth_floor: -80,
  growth_cap: 200,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  copy_weight: 0.02,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Which tier of the board a row sits in. */
export type Tier = 'launch' | 'copy';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  tier: Tier;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the farm plan travels with it, as board.json has it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  tier: Tier;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  launch_size: number;
  copy_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_weight_up : model.growth_weight_down;
  const growthMult = 1 + (growthPct / 100) * weight;
  const ageForModel = age ?? model.unknown_age_days;
  const cappedAge = Math.min(Math.max(ageForModel, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (Math.log(1 + cappedAge) / Math.log(1 + model.maturity_days)) * model.maturity_range;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name: a product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Categories that are a wrapped, staked or bridged product, or a centralised exchange. */
const COPY_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged copy rather than a launch of its own. */
export function isCopy(p: SnapshotProtocol): boolean {
  return (p.category !== null && COPY_CATEGORIES.has(p.category)) || VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name);
}

/** Whether a protocol belongs in the launch tier: pre-token and not a copy. */
export function isLaunch(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isCopy(p);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n and copies at the bottom. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const launches = new Map<string, SnapshotProtocol>();
  const copies = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names belongs in the launch tier. A watchlist
  // slug the snapshot no longer carries cannot happen, but the board never gambles coverage
  // on a missing record.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) (isCopy(p) ? copies : launches).set(slug, p);
  }
  // The early radar: every other pre-token protocol, launch tier by TVL, copies set aside.
  // Never a replacement for a watchlist row: a chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) || launches.has(p.slug) || copies.has(p.slug)) continue;
    (isCopy(p) ? copies : launches).set(p.slug, p);
  }

  const scoredLaunches = [...launches.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scoredLaunches.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const minLaunch = scoredLaunches.length > 0 ? scoredLaunches[scoredLaunches.length - 1]!.implied : 1;
  const copyCap = Math.max(1, Math.floor(minLaunch / 2));

  const scoredCopies = [...copies.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v, raw: v.implied * model.copy_weight };
  });
  const maxRaw = scoredCopies.reduce((m, s) => Math.max(m, s.raw), 0);
  scoredCopies.sort((a, b) => b.raw - a.raw || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const copyRows: BoardRow[] = scoredCopies.map((s) => {
    // Copies are measured on the same ruler at a 2% weight, then rescaled so the largest
    // copy stays below the smallest launch: their order is their own, their place is below.
    const implied = maxRaw > 0 ? Math.max(1, Math.round((s.raw / maxRaw) * copyCap)) : 1;
    return toRow(s.p, s, implied, 'copy');
  });
  const launchRows: BoardRow[] = scoredLaunches.map((s) => toRow(s.p, s, s.implied, 'launch'));
  const rows = [...launchRows, ...copyRows];
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function toRow(p: SnapshotProtocol, v: { growthPct: number; growthMult: number; maturityMult: number; age: number | null }, implied: number, tier: Tier): BoardRow {
  return {
    rank: 0,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    tier,
    age_days: v.age,
    implied_value_usd: implied,
    model: {
      base_multiple: MODEL.base_multiple,
      growth_pct: v.growthPct,
      growth_multiplier: round4(v.growthMult),
      maturity_multiplier: round4(v.maturityMult),
      age_days: v.age,
    },
    farm_steps: farmSteps(p, v.age).map(stepText),
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one farm position costs to set up on a chain, in dollars of gas. */
function gasFor(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 9;
  if (c === 'solana') return 1;
  if (c === 'bitcoin') return 4;
  if (c === 'tron' || c === 'bsc' || c === 'binance') return 1;
  return 2;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 100;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's first action, in the words a farmer can follow, naming the protocol's own app. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const app = `${name}'s own app on ${chain}`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} through ${app} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Provide $${capital} of liquidity to ${name}'s main pool through ${app} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${app}, then use the bridged funds in the app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${app} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} through ${app} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} through ${app} and place one market position.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault through ${app} and keep the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${app}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset through ${app} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} through ${app} and keep the policy.`;
  if (c.includes('chain')) return `Use $${capital} of the chain's gas token in ${name}'s own app on ${chain} and keep the activity going.`;
  if (c.includes('payment')) return `Spend $${capital} through ${name}'s payments app on ${chain} and keep the card or account active.`;
  if (c.includes('privacy')) return `Use $${capital} through ${name}'s private app on ${chain} and keep the shielded balance.`;
  if (c.includes('basis')) return `Open a $${capital} basis trade on ${name} through ${app}: buy spot and short the same amount on the perpetual, and keep both legs open.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} managed vault through ${app} and let it rebalance the range for you.`;
  if (c.includes('governance')) return `Lock or delegate $${capital} of voting power through ${app} and vote on the proposals that are open.`;
  if (c.includes('btc')) return `Deposit $${capital} of BTC through ${app} and hold the receipt token it issues.`;
  if (c.includes('cedefi')) return `Deposit $${capital} into ${name}'s CeDeFi vault through ${app} and keep the position open.`;
  if (c.includes('otc')) return `Fill a $${capital} OTC order on ${name} through ${app} and settle it on-chain.`;
  if (c.includes('card')) return `Load $${capital} onto the ${name} card through ${app} and spend it so the account stays active.`;
  if (c.includes('cex') || c === 'centralized exchange') return `Open an account with ${name} through its own app and deposit $${capital} to trade.`;
  return `Deposit $${capital} of USDC into ${name} through ${app} and keep the position open.`;
}

/** The category's second qualifying action: a different interaction from the first. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const app = `${name}'s own app on ${chain}`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${Math.max(10, Math.round(capital / 5))} against the supply on ${app}, then repay it the same week.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Swap $${Math.max(10, Math.round(capital / 5))} through ${name}'s main pool on ${app}.`;
  if (c.includes('bridge')) return `Bridge a second, smaller amount back through ${app} so the route is used both ways.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim or restake the staking rewards on ${app} once they appear.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Close the first trade on ${app} and open a second one half its size.`;
  if (c.includes('prediction')) return `Settle the first market on ${app} and place a second, smaller position.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Move $${Math.max(10, Math.round(capital / 5))} between two ${name} vaults on ${app}.`;
  if (c.includes('stable')) return `Redeem a small part of the stable position on ${app}, then deposit it back.`;
  if (c.includes('rwa')) return `Claim the yield the asset paid on ${app} and reinvest it in the same asset.`;
  if (c.includes('insurance')) return `File a test claim for a covered event on ${app} and follow it to a decision.`;
  if (c.includes('basis')) return `Rebalance the two legs on ${app} when the funding rate flips against the trade.`;
  if (c.includes('liquidity manager')) return `Claim the rebalancing fees ${name} earned on ${app}.`;
  if (c.includes('governance')) return `Vote on a second proposal on ${app} once it opens.`;
  if (c.includes('btc')) return `Move a small amount of the receipt token on ${app} so the position is used, not just held.`;
  if (c.includes('cedefi')) return `Claim the vault yield ${name} paid on ${app}.`;
  if (c.includes('otc')) return `Fill a second, smaller OTC order on ${app}.`;
  if (c.includes('card')) return `Spend a small amount through the card on ${app}.`;
  if (c.includes('cex')) return `Place a second, smaller trade on ${app}.`;
  return `Make a second, smaller deposit of $${Math.max(10, Math.round(capital / 5))} on ${app}.`;
}

/** The category's weekly qualifying action: the one interaction that keeps the position
 *  counting, repeated every week. A generic "do something each week" names four different
 *  actions — a deposit, a borrow, a swap, a vote — and for most protocols three of them make
 *  no sense: a borrow is meaningless for a vault, a vote for a lending pool. This names the
 *  action that fits this protocol's own category, so the reader knows exactly what to repeat. */
function weeklyActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const app = `${name}'s own app on ${chain}`;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Top up the supply by $${small} on ${app} each week so the position keeps growing.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Collect the pool fees on ${app} each week and add them back to the position.`;
  if (c.includes('bridge')) return `Bridge $${small} through ${app} each week, alternating direction so the route stays active.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim or restake the staking rewards on ${app} once a week.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Open and close one small hedged trade a week on ${app}.`;
  if (c.includes('prediction')) return `Place one small market position a week on ${app}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Claim the vault yield on ${app} each week and redeposit it into the same vault.`;
  if (c.includes('stable')) return `Top up the stable position by $${small} on ${app} each week.`;
  if (c.includes('rwa')) return `Top up the position by $${small} on ${app} each week so the holding keeps growing.`;
  if (c.includes('insurance')) return `Renew or top up the cover on ${app} each week while the policy runs.`;
  if (c.includes('chain')) return `Make one small transaction in ${name}'s own app on ${chain} each week.`;
  if (c.includes('payment')) return `Spend $${small} through ${name}'s payments app on ${chain} each week.`;
  if (c.includes('privacy')) return `Refresh the shielded balance through ${name}'s private app on ${chain} each week.`;
  if (c.includes('basis')) return `Check the funding rate on ${app} each week and rebalance the legs when it flips.`;
  if (c.includes('liquidity manager')) return `Claim the vault fees on ${app} each week and add them back to the position.`;
  if (c.includes('governance')) return `Vote on each new proposal on ${app} every week while the position is locked.`;
  if (c.includes('btc')) return `Top up the BTC deposit by $${small} on ${app} each week so the position keeps growing.`;
  if (c.includes('cedefi')) return `Claim the vault yield on ${app} each week and redeposit it into the same vault.`;
  if (c.includes('otc')) return `Place one small OTC order a week on ${app}.`;
  if (c.includes('card')) return `Spend $${small} through the ${name} card on ${chain} each week.`;
  if (c.includes('cex')) return `Make one small trade a week on ${app}.`;
  return `Deposit $${small} of USDC into ${name} through ${app} each week so the position keeps qualifying.`;
}

/** The category's exit step: how to unwind this protocol's own positions, in the order
 *  that does not strand funds — repay before withdrawing a loan, close the short leg
 *  before selling the spot leg of a basis trade, redeem before withdrawing a vault.
 *  The farm log stays in every version: the step is specific about the exit and keeps the
 *  record-keeping, instead of repeating one generic line on all 342 rows. */
function exitActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const app = `${name}'s own app on ${chain}`;
  const log = `and write the wallet, the dates and every transaction in a farm log.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `To exit, repay the borrow first, then withdraw the supply — in that order — ${log}`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `To exit, claim the pool fees first, then remove the liquidity, ${log}`;
  if (c.includes('bridge')) return `To exit, bridge the funds back to the chain you started on, ${log}`;
  if (c.includes('staking') || c.includes('restak')) return `To exit, claim the staking rewards first, then unstake, ${log}`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `To exit, close every open trade first, then withdraw the margin, ${log}`;
  if (c.includes('prediction')) return `To exit, settle or close every open market position, then withdraw, ${log}`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `To exit, claim the vault yield first, then withdraw from the vault, ${log}`;
  if (c.includes('stable')) return `To exit, redeem the stable position back to USDC, ${log}`;
  if (c.includes('rwa')) return `To exit, redeem the yield asset on ${app}, ${log}`;
  if (c.includes('insurance')) return `To exit, let the cover lapse or cancel the policy, ${log}`;
  if (c.includes('basis')) return `To exit, close the short leg first, then sell the spot leg, ${log}`;
  if (c.includes('liquidity manager')) return `To exit, claim the vault fees first, then withdraw from the managed vault, ${log}`;
  if (c.includes('governance')) return `To exit, unlock the voting power after the vote closes, ${log}`;
  if (c.includes('btc')) return `To exit, redeem the receipt token for BTC on ${app}, ${log}`;
  if (c.includes('cedefi')) return `To exit, withdraw from the CeDeFi vault on ${app}, ${log}`;
  if (c.includes('otc')) return `To exit, cancel any open OTC orders on ${app}, then withdraw, ${log}`;
  if (c.includes('card')) return `To exit, spend down or withdraw the card balance on ${app}, ${log}`;
  if (c.includes('cex')) return `To exit, withdraw the balance from ${name} to your own wallet, ${log}`;
  return `Write the wallet, the dates and every transaction in a farm log, then unwind in reverse order when you exit.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Every step names the chain and the protocol's own app, and the
 * weekly step names the category's own qualifying action (see weeklyActionFor), so the plan
 * tells the reader exactly which interaction to repeat — not a generic list of options.
 * The exit step names the category's own unwind order too (see exitActionFor), so the
 * last step is specific to the positions the plan opened.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `under $${gas + 2} of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $${gas} of gas on ${chain}`,
      time: '10 minutes',
    },
    {
      text: weeklyActionFor(p, capital, chain),
      cost: `about $${gas} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page in its app on ${chain} and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: exitActionFor(p, chain),
      cost: `about $${gas} of gas to unwind on ${chain}`,
      time: '15 minutes to exit',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan as board.json has it. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    tier: row.tier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const launch = board.filter((r) => r.tier === 'launch').length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    launch_size: launch,
    copy_size: board.length - launch,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
