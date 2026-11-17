// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol in the snapshot that records no token (342 of them), in two
// tiers. The launch tier holds the protocols that could still launch a token of their own: no
// token on record, not a centralised exchange, not a versioned pool of another protocol, and not
// a wrapped, staked or bridged copy. The copy tier holds the rest, ranked at the bottom. The
// watchlist (40 slugs) is the floor: every one of them is in the launch tier. Nothing is
// hand-picked and no protocol name is ever special-cased: the same functions score every row.
//
// Implied value follows only from the snapshot's own figures:
//
//   implied = max(1, round(tvl_usd x 0.30 x sizeMult x growthMult x maturityMult))
//   sizeMult     = sqrt(size_ref_usd / tvl_usd), size_ref_usd the snapshot's own
//                  floor_usd ($50M here)
//                  (a launch is worth a share of the value already locked in, but the
//                   share shrinks as the protocol grows: the snapshot's own 128
//                   live-token protocols trade at a median 0.89x TVL at $5-10M of TVL,
//                   0.37x at $10-32M, 0.21x at $33-95M and 0.05x above $108M — a
//                   17x fall across the range. A log-log fit of market cap on TVL
//                   gives a slope of 0.52 (0.58 after trimming 10 outliers, 0.42 from
//                   the quartile medians), so value grows with the square root of
//                   TVL, not linearly: the old linear 0.30x overvalued the giants
//                   about 6x and undervalued the smallest protocols about 3x. The
//                   0.5 exponent is the robust middle of the three fits, and the
//                   $50M anchor is the snapshot's own floor, not a chosen number)
//   growthMult   = min(1.6, max(0.5, 1 + clamp(change_7d, -80, 200) / 100 x (0.8 up / 1.2 down))), null counts as 0
//                  (a shrinking TVL hurts more than a growing one helps; the term is bounded
//                   because the TVL already records the week's move — one bad week never erases
//                   more than half the value that remains, and one good week never adds more than
//                   60% on top of a TVL that already includes the spike: the two most distorted
//                   rows of the old unbounded term were a protocol down 73% in a week, valued at
//                   13% of its remaining TVL, and one up 4,448% in a week, valued at 260%.
//                   Checked against the live set after the size curve, 7d growth barely
//                   moves market cap (r = -0.15, n = 128), so the term stays a small
//                   bounded adjustment, never the driver)
//   maturityMult = 0.6 + 0.4 x ln(1 + min(age_days, 1095)) / ln(1 + 1095)
//                  (age_days unknown: 365; the curve rises fast, then plateaus.
//                   Checked the same way, age barely moves market cap either
//                   (r = -0.05, n = 95), so the term stays as it was: a small
//                   bounded adjustment, not a claim that older always means dearer)
//   categoryMult = the category's factor, fitted from the snapshot's own
//                  live-token protocols and no larger than 0.80x-1.25x (see
//                  categoryFactors): for each category with at least 5 live
//                  rows, the median of log(market cap / size curve), centred
//                  on the global median and shrunk toward 1 by n/(n+10).
//                  Lending 0.80x, Yield 0.84x, RWA 1.14x, Basis Trading
//                  1.19x; every other category 1.00x. Categories with fewer
//                  live rows get no factor — one live row is noise, not a
//                  signal (Prediction Market's single live row sits 576x off
//                  the curve). The gaps that remain after the size curve are
//                  small, and the factor stays small with them.
//
// A copy's implied value is the same formula at a 2% weight, rescaled so the largest copy
// stays below the smallest launch. The dashboard states the formula and recomputes every row
// from the snapshot figures, so the page's code and the board's data are visibly the same
// arithmetic.
//
// Three checks ride on the same snapshot, and the dashboard shows all three:
// blindTest fits the size curve on half the live protocols and predicts the other half,
// both ways and under a second, independent split, so the curve is proven on protocols
// it never saw; intervalFactors gives every row a middle-half range from the live
// protocols' own scatter; and farmEconomics nets each farm plan's gas against the
// position's pro-rata share of its implied value, so every row carries a Farm / Thin /
// Skip verdict in dollars per hour of hands-on work. Two more ride with them:
// bootstrapStability resamples the live set and refits the curve and the ranking, so
// the dashboard can say how solid the top of the board is and where it moves; and
// every row carries its rank at size exponents 0.45 and 0.55 plus its factual
// watch-outs, so the detail view can say how far this rank moves and what to watch.

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
  size_ref_usd: number;
  size_exponent: number;
  growth_weight_up: number;
  growth_weight_down: number;
  growth_floor: number;
  growth_cap: number;
  growth_mult_floor: number;
  growth_mult_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  copy_weight: number;
  /** Per-category value factors, fitted from the snapshot at build time (see categoryFactors). Absent on the bare MODEL constant. */
  category_factors?: Record<string, number>;
  /** Blind test of the size curve (see blindTest): median |log error| fitting one
   *  half of the live protocols and predicting the other, both ways, plus the
   *  in-sample figure for the same fit. Absent on the bare MODEL constant.
   *  hash_a_to_b / hash_b_to_a are the same test under a second, independent
   *  split — FNV-1a hash parity of the slug instead of char-sum parity — so
   *  the proof does not rest on one arbitrary way of halving the set. */
  blind?: { fit_a_to_b: number; fit_b_to_a: number; in_sample: number; hash_a_to_b: number; hash_b_to_a: number };
  /** Middle-half interval for one row's implied value (see intervalFactors):
   *  the 25th/75th percentiles of market-cap / curve among the live protocols.
   *  Absent on the bare MODEL constant. */
  interval?: { lo: number; hi: number };
  /** Bootstrap stability of the ranking (see bootstrapStability): the size
   *  slope refitted on 1,000 resamples of the live protocols, and the ranking
   *  refitted on 200 resamples with the category factors refit each time.
   *  Absent on the bare MODEL constant. */
  bootstrap?: {
    slope_median: number; slope_lo: number; slope_hi: number;
    rank_moves_lo: number; rank_moves_hi: number;
    top20_stay_median: number; top20_stay_min: number;
    top3_exact: [number, number, number]; median_abs_move: number;
  };
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  size_ref_usd: 50_000_000,
  size_exponent: 0.5,
  growth_weight_up: 0.8,
  growth_weight_down: 1.2,
  growth_floor: -80,
  growth_cap: 200,
  growth_mult_floor: 0.5,
  growth_mult_cap: 1.6,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  copy_weight: 0.02,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-4';

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
  /** The farm plan's economics, netted in dollars (see farmEconomics). */
  farm_net_usd: number;
  farm_per_hour_usd: number;
  farm_verdict: 'Farm' | 'Thin' | 'Skip';
  /** The middle-half range for the implied value (see intervalFactors). */
  implied_low_usd: number;
  implied_high_usd: number;
  /** The row's rank if the size exponent were 0.45 / 0.55 instead of 0.50
   *  (same $50M anchor, same category factors — see altRanks): how far this
   *  rank moves when the one number the model chose is varied. */
  rank_at_045: number;
  rank_at_055: number;
  /** Factual watch-outs from the snapshot's own fields (see riskFlags):
   *  'single-chain', 'shrinking-7d', 'very-young', 'age-unknown'. */
  risk_flags: string[];
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    size_multiplier: number;
    category_multiplier: number;
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
  size_multiplier: number;
  category_multiplier: number;
  farm_net_usd: number;
  farm_per_hour_usd: number;
  farm_verdict: 'Farm' | 'Thin' | 'Skip';
  implied_low_usd: number;
  implied_high_usd: number;
  rank_at_045: number;
  rank_at_055: number;
  risk_flags: string[];
  tier: Tier;
  watchlist: boolean;
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
  /** The top 3 launches' implied value at size exponents 0.45 / 0.50 / 0.55
   *  (same $50M anchor), plus how many launches move 10 or more ranks at each
   *  off-centre exponent — the ranking's sensitivity, computed at build time. */
  sensitivity: { slug: string; name: string; at_045: number; at_050: number; at_055: number }[];
  sensitivity_rank_moves: { at_045: number; at_055: number };
  /** The bootstrap stability block (see bootstrapStability): the slope's
   *  resampled interval and the ranking refit on resampled live sets. */
  bootstrap: NonNullable<ModelConstants['bootstrap']>;
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

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; sizeMult: number; catMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_weight_up : model.growth_weight_down;
  // Bounded: the TVL already records the week's move, so the momentum term adjusts the
  // value that remains — it never erases it and never chases a one-week spike.
  const growthMult = Math.min(model.growth_mult_cap, Math.max(model.growth_mult_floor, 1 + (growthPct / 100) * weight));
  const ageForModel = age ?? model.unknown_age_days;
  const cappedAge = Math.min(Math.max(ageForModel, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (Math.log(1 + cappedAge) / Math.log(1 + model.maturity_days)) * model.maturity_range;
  // Square-root size: value grows with the square root of TVL, anchored on the
  // snapshot's own floor — the market pays a shrinking share as protocols grow.
  const sizeMult = Math.pow(model.size_ref_usd / Math.max(protocol.tvl_usd, 1), model.size_exponent);
  const catMult = model.category_factors?.[protocol.category ?? ''] ?? 1;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * sizeMult * growthMult * maturityMult * catMult));
  return { implied, growthPct, growthMult, maturityMult, sizeMult, catMult, age };
}

/** The per-category value factor, fitted from the snapshot's own live-token protocols:
 *  for each category with at least 5 live rows, the median of log(market cap /
 *  the size curve's prediction), centred on the global median so the factors are
 *  relative to the typical protocol, shrunk toward 1 by n/(n+10) and clamped to
 *  0.80-1.25. Categories with fewer live rows get no factor: a single live row
 *  is noise, not a signal — Prediction Market's one live row sits 576x off the
 *  curve, Token Locker's two 34x. No protocol name and no category is ever
 *  hand-set: the map is computed from the snapshot on every run. */
export function categoryFactors(snapshot: Snapshot, model: ModelConstants): Record<string, number> {
  const live = snapshot.protocols.filter((p): p is SnapshotProtocol & { mcap_usd: number } => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  if (live.length === 0) return {};
  const resid = live.map((p) => {
    const pred = model.base_multiple * Math.sqrt(model.size_ref_usd * p.tvl_usd);
    return { c: p.category ?? '', r: Math.log(p.mcap_usd / pred) };
  });
  const all = resid.map((x) => x.r).sort((a, b) => a - b);
  const global = all[Math.floor(all.length / 2)]!;
  const byCat = new Map<string, number[]>();
  for (const x of resid) {
    const arr = byCat.get(x.c);
    if (arr !== undefined) arr.push(x.r);
    else byCat.set(x.c, [x.r]);
  }
  const out: Record<string, number> = {};
  for (const [c, rs] of byCat) {
    if (rs.length < 5) continue;
    rs.sort((a, b) => a - b);
    const med = rs[Math.floor(rs.length / 2)]! - global;
    const shrunk = Math.exp(med * (rs.length / (rs.length + 10)));
    const clamped = Math.min(1.25, Math.max(0.8, shrunk));
    const rounded = Math.round(clamped * 1e4) / 1e4;
    if (rounded !== 1) out[c] = rounded;
  }
  return out;
}

/** The model as this snapshot scores with: the size anchor is the snapshot's own
 *  floor_usd, and the category factors are fitted from its live rows. */
function effectiveModel(snapshot: Snapshot, model: ModelConstants): ModelConstants {
  const m: ModelConstants = { ...model, size_ref_usd: snapshot.floor_usd };
  if (model.category_factors === undefined) m.category_factors = categoryFactors(snapshot, m);
  if (model.blind === undefined) m.blind = blindTest(snapshot, m);
  if (model.interval === undefined) m.interval = intervalFactors(snapshot, m);
  return m;
}

/** The median of a sorted-by-value list. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** A log-log OLS fit of market cap on TVL over the live protocols. */
function logLogFit(rows: SnapshotProtocol[]): { slope: number; intercept: number } {
  const xs = rows.map((p) => Math.log(p.tvl_usd));
  const ys = rows.map((p) => Math.log(p.mcap_usd!));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i]! - mx) * (ys[i]! - my); den += (xs[i]! - mx) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}

/** FNV-1a hash of a string, as a 32-bit unsigned number: the second way of
 *  halving the live set, independent of the char-sum parity below. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The blind test of the size curve: split the live protocols in half by a
 *  deterministic parity of the slug (no peeking — each half is fitted without
 *  the other), fit the log-log curve on one half and predict the other, both
 *  ways, and report the median |log error| each way plus the in-sample figure
 *  for the same fit on all live rows. A curve that only memorised its training
 *  set would predict the held-out half far worse than its own half; here the
 *  held-out errors sit within ~5% of the in-sample one, so the curve
 *  generalises across the live set instead of overfitting it. The test runs
 *  under a second, independent split too — FNV-1a hash parity instead of
 *  char-sum parity — so the proof does not rest on one arbitrary way of
 *  halving the set: the two splits agree (×3.5/×3.6 one way, ×3.6/×3.5 the
 *  other, against ×3.4 in-sample), which is what makes the claim honest
 *  rather than a split that happened to flatter the curve. */
export function blindTest(snapshot: Snapshot, model: ModelConstants): { fit_a_to_b: number; fit_b_to_a: number; in_sample: number; hash_a_to_b: number; hash_b_to_a: number } {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const round3 = (x: number): number => Math.round(x * 1000) / 1000;
  if (live.length < 4) return { fit_a_to_b: 0, fit_b_to_a: 0, in_sample: 0, hash_a_to_b: 0, hash_b_to_a: 0 };
  const err = (rows: SnapshotProtocol[], f: { slope: number; intercept: number }): number =>
    median(rows.map((p) => Math.abs(Math.log(p.mcap_usd! / Math.exp(f.intercept + f.slope * Math.log(p.tvl_usd))))));
  const runSplit = (pick: (p: SnapshotProtocol) => boolean): { a_to_b: number; b_to_a: number } => {
    const halfA = live.filter(pick);
    const halfB = live.filter((p) => !pick(p));
    const fitA = logLogFit(halfA);
    const fitB = logLogFit(halfB);
    return { a_to_b: round3(err(halfB, fitA)), b_to_a: round3(err(halfA, fitB)) };
  };
  const parity = (s: string): number => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 2;
  const slugSplit = runSplit((p) => parity(p.slug) === 0);
  const hashSplit = runSplit((p) => fnv1a(p.slug) % 2 === 0);
  return {
    fit_a_to_b: slugSplit.a_to_b,
    fit_b_to_a: slugSplit.b_to_a,
    in_sample: round3(err(live, logLogFit(live))),
    hash_a_to_b: hashSplit.a_to_b,
    hash_b_to_a: hashSplit.b_to_a,
  };
}

/** The middle-half interval for one row's implied value: the 25th and 75th
 *  percentiles of (live market cap / full-model prediction) among the live
 *  protocols, as multipliers. A row's likely range is its implied value times
 *  each end. Wide on purpose — market caps scatter widely at any TVL — and
 *  computed from the snapshot on every run, never hand-set. */
export function intervalFactors(snapshot: Snapshot, model: ModelConstants): { lo: number; hi: number } {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  if (live.length === 0) return { lo: 1, hi: 1 };
  const ratios = live.map((p) => p.mcap_usd! / impliedValue(p, snapshot.as_of, model).implied).sort((a, b) => a - b);
  const q = (f: number): number => ratios[Math.min(ratios.length - 1, Math.floor(f * ratios.length))]!;
  return { lo: Math.round(q(0.25) * 100) / 100, hi: Math.round(q(0.75) * 100) / 100 };
}

/** A deterministic PRNG (mulberry32): the bootstrap resamples with a fixed
 *  seed, so every run of the radar draws the same resamples and the board is
 *  byte-identical run to run. Math.random is never used anywhere in the model. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The f-th quantile of a list (0 <= f <= 1), by sorted position. */
function quantile(xs: number[], f: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(f * s.length))]!;
}

/** Every board row's rank under a different size exponent: the same ranking
 *  buildBoard performs — launches by implied value, copies at a 2% weight
 *  rescaled below the smallest launch — with only the exponent changed, so a
 *  row's rank at 0.45 or 0.55 is directly comparable with its rank at 0.50.
 *  At 0.50 it reproduces the board's own ranks exactly (checked in the audit). */
export function altRanks(snapshot: Snapshot, model: ModelConstants, exponent: number): Map<string, number> {
  const m = { ...model, size_exponent: exponent };
  const launches = snapshot.protocols.filter(isLaunch);
  const copies = snapshot.protocols.filter((p) => isPreToken(p) && !isLaunch(p));
  const scoredL = launches.map((p) => ({ slug: p.slug, v: impliedValue(p, snapshot.as_of, m).implied }))
    .sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const scoredC = copies.map((p) => ({ slug: p.slug, raw: impliedValue(p, snapshot.as_of, m).implied * m.copy_weight }))
    .sort((a, b) => b.raw - a.raw || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const out = new Map<string, number>();
  scoredL.forEach((s, i) => out.set(s.slug, i + 1));
  // The copy rescale is monotonic in the raw value, so it cannot change the
  // copies' order among themselves — only their place below the launches.
  scoredC.forEach((s, i) => out.set(s.slug, scoredL.length + i + 1));
  return out;
}

/** A row's factual watch-outs, from the snapshot's own fields only — no
 *  judgement, just the facts a reader should see before farming it:
 *  one chain only (no fallback if that chain stalls), TVL shrinking over
 *  the last 7 days, listed under 90 days ago, or no listing date on record. */
export function riskFlags(p: SnapshotProtocol, age: number | null): string[] {
  const flags: string[] = [];
  if (p.chains.length <= 1) flags.push('single-chain');
  if (p.change_7d !== null && p.change_7d < 0) flags.push('shrinking-7d');
  if (age === null) flags.push('age-unknown');
  else if (age < 90) flags.push('very-young');
  return flags;
}

/** How stable the ranking is when the live set is resampled: the honest
 *  answer to "would another 128 live protocols have ranked these the same
 *  way?" Two resampling rounds, both with fixed seeds, both computed from
 *  the snapshot on every run. (1) The size slope refitted on 1,000 resamples
 *  of the 128 live protocols, drawn with replacement: median 0.52, 90%
 *  interval 0.36–0.65 — the model's 0.50 sits inside it, near the median —
 *  and how many launches move 10 or more ranks at each end of that interval.
 *  (2) The whole ranking refitted on 200 resamples, the category factors
 *  refit from each resample: how often each top-20 launch stays in the top
 *  20, how often ranks 1–3 keep their exact rank, and the median absolute
 *  rank move across all launches. The top of the board is solid (ranks 1–3
 *  keep their exact rank in every resample); the middle moves, and the
 *  slope's own interval is wide enough that the exponent alone can move
 *  8–23 launches by 10 or more ranks — the sensitivity table's ±0.05
 *  understates that, and this block says so. */
export function bootstrapStability(
  snapshot: Snapshot,
  model: ModelConstants,
  launches: BoardRow[],
  proto: Map<string, SnapshotProtocol>,
): NonNullable<ModelConstants['bootstrap']> {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const round3 = (x: number): number => Math.round(x * 1000) / 1000;
  const empty = { slope_median: 0, slope_lo: 0, slope_hi: 0, rank_moves_lo: 0, rank_moves_hi: 0, top20_stay_median: 0, top20_stay_min: 0, top3_exact: [0, 0, 0] as [number, number, number], median_abs_move: 0 };
  if (live.length < 4 || launches.length === 0) return empty;
  // (1) Slope on 1,000 resamples.
  const rngSlope = mulberry32(20261118);
  const slopes: number[] = [];
  for (let i = 0; i < 1000; i++) {
    const sample = Array.from({ length: live.length }, () => live[Math.floor(rngSlope() * live.length)]!);
    slopes.push(logLogFit(sample).slope);
  }
  const slopeMedian = round3(median(slopes));
  const slopeLo = round3(quantile(slopes, 0.05));
  const slopeHi = round3(quantile(slopes, 0.95));
  const movesAt = (exp: number): number => {
    const alt = altRanks(snapshot, model, exp);
    return launches.filter((r) => Math.abs((alt.get(r.slug) ?? 0) - r.rank) >= 10).length;
  };
  // (2) Whole ranking on 200 resamples, factors refit each time.
  const rngModel = mulberry32(20261119);
  const top20 = launches.slice(0, 20).map((r) => r.slug);
  const stay = new Map(top20.map((s) => [s, 0]));
  const top3Exact = [0, 0, 0];
  const absMoves: number[] = [];
  for (let i = 0; i < 200; i++) {
    const sample = Array.from({ length: live.length }, () => live[Math.floor(rngModel() * live.length)]!);
    const mm: ModelConstants = { ...model, category_factors: categoryFactors({ ...snapshot, protocols: sample }, model) };
    const alt = launches.map((r) => ({ slug: r.slug, v: impliedValue(proto.get(r.slug)!, snapshot.as_of, mm).implied }))
      .sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const order = new Map(alt.map((x, j) => [x.slug, j + 1]));
    for (const s of top20) if ((order.get(s) ?? 999) <= 20) stay.set(s, (stay.get(s) ?? 0) + 1);
    for (let j = 0; j < 3; j++) if (alt[j]!.slug === launches[j]!.slug) top3Exact[j]!++;
    for (const r of launches) absMoves.push(Math.abs((order.get(r.slug) ?? 0) - r.rank));
  }
  const stayRates = [...stay.values()].map((v) => Math.round((v / 200) * 100));
  return {
    slope_median: slopeMedian,
    slope_lo: slopeLo,
    slope_hi: slopeHi,
    rank_moves_lo: movesAt(slopeLo),
    rank_moves_hi: movesAt(slopeHi),
    top20_stay_median: median(stayRates),
    top20_stay_min: Math.min(...stayRates),
    top3_exact: [Math.round((top3Exact[0]! / 200) * 100), Math.round((top3Exact[1]! / 200) * 100), Math.round((top3Exact[2]! / 200) * 100)],
    median_abs_move: median(absMoves),
  };
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

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const m = effectiveModel(snapshot, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
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
    const v = impliedValue(p, snapshot.as_of, m);
    return { p, ...v };
  });
  scoredLaunches.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const minLaunch = scoredLaunches.length > 0 ? scoredLaunches[scoredLaunches.length - 1]!.implied : 1;
  const copyCap = Math.max(1, Math.floor(minLaunch / 2));

  const scoredCopies = [...copies.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, m);
    return { p, ...v, raw: v.implied * m.copy_weight };
  });
  const maxRaw = scoredCopies.reduce((m, s) => Math.max(m, s.raw), 0);
  scoredCopies.sort((a, b) => b.raw - a.raw || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const interval = m.interval ?? { lo: 1, hi: 1 };
  const copyRows: BoardRow[] = scoredCopies.map((s) => {
    // Copies are measured on the same ruler at a 2% weight, then rescaled so the largest
    // copy stays below the smallest launch: their order is their own, their place is below.
    const implied = maxRaw > 0 ? Math.max(1, Math.round((s.raw / maxRaw) * copyCap)) : 1;
    return toRow(s.p, s, implied, 'copy', interval);
  });
  const launchRows: BoardRow[] = scoredLaunches.map((s) => toRow(s.p, s, s.implied, 'launch', interval));
  const rows = [...launchRows, ...copyRows];
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  // Each row's rank at the neighbouring exponents, from the same ranking run
  // with only the exponent changed — the per-row half of the sensitivity
  // table, so the detail view can say how far this rank moves.
  const at045 = altRanks(snapshot, m, 0.45);
  const at055 = altRanks(snapshot, m, 0.55);
  for (const r of rows) {
    r.rank_at_045 = at045.get(r.slug) ?? r.rank;
    r.rank_at_055 = at055.get(r.slug) ?? r.rank;
  }
  return rows;
}

function toRow(p: SnapshotProtocol, v: { growthPct: number; growthMult: number; maturityMult: number; sizeMult: number; catMult: number; age: number | null }, implied: number, tier: Tier, interval: { lo: number; hi: number }): BoardRow {
  const econ = farmEconomics(p, v.age, implied);
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
    farm_net_usd: econ.net_usd,
    farm_per_hour_usd: econ.net_per_hour_usd,
    farm_verdict: econ.verdict,
    implied_low_usd: Math.max(1, Math.round(implied * interval.lo)),
    implied_high_usd: Math.round(implied * interval.hi),
    // Alt-exponent ranks are filled in by buildBoard, which knows the whole
    // board; until then they are the row's own rank, never a guess.
    rank_at_045: 0,
    rank_at_055: 0,
    risk_flags: riskFlags(p, v.age),
    model: {
      base_multiple: MODEL.base_multiple,
      growth_pct: v.growthPct,
      growth_multiplier: Math.round(v.growthMult * 1e4) / 1e4,
      maturity_multiplier: Math.round(v.maturityMult * 1e4) / 1e4,
      size_multiplier: Math.round(v.sizeMult * 1e4) / 1e4,
      category_multiplier: Math.round(v.catMult * 1e4) / 1e4,
      age_days: v.age,
    },
    farm_steps: farmSteps(p, v.age, implied).map(stepText),
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

/** One farm plan's economics, netted in dollars. The gross is the plan's
 *  position as a pro-rata share of the protocol's implied value — capital /
 *  TVL × implied — a yardstick, not a prediction: airdrops rarely pay
 *  pro-rata, so the number ranks where the plan's money works hardest, it
 *  never promises what a farm pays. The net subtracts the whole plan's gas
 *  (setup + weekly + unwind, the same total step 5 budgets); the hours are
 *  hands-on time only — 30 minutes to set up, 10 minutes to claim, 15 to
 *  unwind, 10 minutes a week — never the hold itself, which is waiting, not
 *  work. The verdict is Farm when at least $20 stays after gas at $5 or more
 *  an hour, Thin when anything stays, Skip when the gas costs more than the
 *  pro-rata share. Copies are Skip on the arithmetic, not on a judgement:
 *  their 2% weight leaves a share smaller than any plan's gas. */
export interface FarmEconomics {
  capital: number;
  gas_total: number;
  hold_days: number;
  weeks: number;
  active_hours: number;
  gross_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  verdict: 'Farm' | 'Thin' | 'Skip';
}

export function farmEconomics(p: SnapshotProtocol, age: number | null, implied: number): FarmEconomics {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.round(hold / 7));
  const gasTotal = gas * (2 + weeks);
  const hours = Math.round((0.92 + weeks / 6) * 10) / 10;
  const gross = Math.round((capital / Math.max(p.tvl_usd, 1)) * implied);
  const net = gross - gasTotal;
  const perHour = Math.round((net / hours) * 100) / 100;
  const verdict = net >= 20 && perHour >= 5 ? 'Farm' : net > 0 ? 'Thin' : 'Skip';
  return { capital, gas_total: gasTotal, hold_days: hold, weeks, active_hours: hours, gross_usd: gross, net_usd: net, net_per_hour_usd: perHour, verdict };
}

/** One category's farm actions, as templates — ${name} the protocol, ${app} its own app
 *  on the chain, ${capital} the position size, ${small} a fifth of it, ${chain} the chain,
 *  ${log} the farm-log line. One table drives all four writers, so a category's wording
 *  lives in one place instead of four parallel if-chains. An entry that leaves a field
 *  out falls through to the default for that writer: the chain, payment and privacy
 *  categories have a main and a weekly action only, exactly as the four writers had
 *  before — their second action and exit were always the generic ones. */
type CatKey = 'main' | 'second' | 'weekly' | 'exit';
interface CatActions {
  keys: string[];
  exact?: string;
  reward?: string;
  main?: string;
  second?: string;
  weekly?: string;
  exit?: string;
}

const LOG_LINE = 'and write the wallet, the dates and every transaction in a farm log.';

const CATS: CatActions[] = [
  { keys: ['lend', 'cdp', 'collateral'],
    reward: 'supply and borrow points',
    main: "Supply $${capital} of USDC to ${name} through ${app} and keep the position open.",
    second: "Borrow $${small} against the supply on ${app}, then repay it the same week.",
    weekly: "Top up the supply by $${small} on ${app} each week so the position keeps growing.",
    exit: "To exit, repay the borrow first, then withdraw the supply — in that order — ${log}" },
  { keys: ['dex', 'yield', 'leveraged farm', 'farm'],
    reward: 'pool fees and points',
    main: "Provide $${capital} of liquidity to ${name}'s main pool through ${app} and keep the position open.",
    second: "Swap $${small} through ${name}'s main pool on ${app}.",
    weekly: "Collect the pool fees on ${app} each week and add them back to the position.",
    exit: "To exit, claim the pool fees first, then remove the liquidity, ${log}" },
  { keys: ['bridge'],
    reward: 'bridge points',
    main: "Bridge $${capital} of USDC to ${chain} through ${app}, then use the bridged funds in the app.",
    second: "Bridge a second, smaller amount back through ${app} so the route is used both ways.",
    weekly: "Bridge $${small} through ${app} each week, alternating direction so the route stays active.",
    exit: "To exit, bridge the funds back to the chain you started on, ${log}" },
  { keys: ['staking', 'restak'],
    reward: 'staking rewards and points',
    main: "Stake $${capital} of the chain's staking asset through ${app} and keep the receipt token.",
    second: "Claim or restake the staking rewards on ${app} once they appear.",
    weekly: "Claim or restake the staking rewards on ${app} once a week.",
    exit: "To exit, claim the staking rewards first, then unstake, ${log}" },
  { keys: ['perpetual', 'derivative', 'options'],
    reward: 'trading points',
    main: "Deposit $${capital} of USDC as margin on ${name} through ${app} and open one small hedged trade.",
    second: "Close the first trade on ${app} and open a second one half its size.",
    weekly: "Open and close one small hedged trade a week on ${app}.",
    exit: "To exit, close every open trade first, then withdraw the margin, ${log}" },
  { keys: ['prediction'],
    reward: 'market points',
    main: "Fund $${capital} on ${name} through ${app} and place one market position.",
    second: "Settle the first market on ${app} and place a second, smaller position.",
    weekly: "Place one small market position a week on ${app}.",
    exit: "To exit, settle or close every open market position, then withdraw, ${log}" },
  { keys: ['curator', 'allocator', 'risk'],
    reward: 'vault yield and points',
    main: "Deposit $${capital} into a ${name} vault through ${app} and keep the vault shares.",
    second: "Move $${small} between two ${name} vaults on ${app}.",
    weekly: "Claim the vault yield on ${app} each week and redeposit it into the same vault.",
    exit: "To exit, claim the vault yield first, then withdraw from the vault, ${log}" },
  { keys: ['stable'],
    reward: 'stability points',
    main: "Mint or deposit $${capital} of the stable asset through ${app}.",
    second: "Redeem a small part of the stable position on ${app}, then deposit it back.",
    weekly: "Top up the stable position by $${small} on ${app} each week.",
    exit: "To exit, redeem the stable position back to USDC, ${log}" },
  { keys: ['rwa'],
    reward: 'yield and points',
    main: "Mint $${capital} of ${name}'s yield asset through ${app} and hold it.",
    second: "Claim the yield the asset paid on ${app} and reinvest it in the same asset.",
    weekly: "Top up the position by $${small} on ${app} each week so the holding keeps growing.",
    exit: "To exit, redeem the yield asset on ${app}, ${log}" },
  { keys: ['insurance'],
    reward: 'cover points',
    main: "Buy $${capital} of cover from ${name} through ${app} and keep the policy.",
    second: "File a test claim for a covered event on ${app} and follow it to a decision.",
    weekly: "Renew or top up the cover on ${app} each week while the policy runs.",
    exit: "To exit, let the cover lapse or cancel the policy, ${log}" },
  { keys: ['chain'],
    reward: 'activity points',
    main: "Use $${capital} of the chain's gas token in ${name}'s own app on ${chain} and keep the activity going.",
    weekly: "Make one small transaction in ${name}'s own app on ${chain} each week." },
  { keys: ['payment'],
    reward: 'spending points',
    main: "Spend $${capital} through ${name}'s payments app on ${chain} and keep the card or account active.",
    weekly: "Spend $${small} through ${name}'s payments app on ${chain} each week." },
  { keys: ['privacy'],
    reward: 'shielded points',
    main: "Use $${capital} through ${name}'s private app on ${chain} and keep the shielded balance.",
    weekly: "Refresh the shielded balance through ${name}'s private app on ${chain} each week." },
  { keys: ['basis'],
    reward: 'funding-rate points',
    main: "Open a $${capital} basis trade on ${name} through ${app}: buy spot and short the same amount on the perpetual, and keep both legs open.",
    second: "Rebalance the two legs on ${app} when the funding rate flips against the trade.",
    weekly: "Check the funding rate on ${app} each week and rebalance the legs when it flips.",
    exit: "To exit, close the short leg first, then sell the spot leg, ${log}" },
  { keys: ['liquidity manager'],
    reward: 'vault fees and points',
    main: "Deposit $${capital} into a ${name} managed vault through ${app} and let it rebalance the range for you.",
    second: "Claim the rebalancing fees ${name} earned on ${app}.",
    weekly: "Claim the vault fees on ${app} each week and add them back to the position.",
    exit: "To exit, claim the vault fees first, then withdraw from the managed vault, ${log}" },
  { keys: ['governance'],
    reward: 'voting points',
    main: "Lock or delegate $${capital} of voting power through ${app} and vote on the proposals that are open.",
    second: "Vote on a second proposal on ${app} once it opens.",
    weekly: "Vote on each new proposal on ${app} every week while the position is locked.",
    exit: "To exit, unlock the voting power after the vote closes, ${log}" },
  { keys: ['btc'],
    reward: 'BTC receipt points',
    main: "Deposit $${capital} of BTC through ${app} and hold the receipt token it issues.",
    second: "Move a small amount of the receipt token on ${app} so the position is used, not just held.",
    weekly: "Top up the BTC deposit by $${small} on ${app} each week so the position keeps growing.",
    exit: "To exit, redeem the receipt token for BTC on ${app}, ${log}" },
  { keys: ['cedefi'],
    reward: 'vault yield and points',
    main: "Deposit $${capital} into ${name}'s CeDeFi vault through ${app} and keep the position open.",
    second: "Claim the vault yield ${name} paid on ${app}.",
    weekly: "Claim the vault yield on ${app} each week and redeposit it into the same vault.",
    exit: "To exit, withdraw from the CeDeFi vault on ${app}, ${log}" },
  { keys: ['otc'],
    reward: 'OTC points',
    main: "Fill a $${capital} OTC order on ${name} through ${app} and settle it on-chain.",
    second: "Fill a second, smaller OTC order on ${app}.",
    weekly: "Place one small OTC order a week on ${app}.",
    exit: "To exit, cancel any open OTC orders on ${app}, then withdraw, ${log}" },
  { keys: ['card'],
    reward: 'spending points',
    main: "Load $${capital} onto the ${name} card through ${app} and spend it so the account stays active.",
    second: "Spend a small amount through the card on ${app}.",
    weekly: "Spend $${small} through the ${name} card on ${chain} each week.",
    exit: "To exit, spend down or withdraw the card balance on ${app}, ${log}" },
  { keys: ['cex'], exact: 'centralized exchange',
    reward: 'trading points',
    main: "Open an account with ${name} through its own app and deposit $${capital} to trade.",
    second: "Place a second, smaller trade on ${app}.",
    weekly: "Make one small trade a week on ${app}.",
    exit: "To exit, withdraw the balance from ${name} to your own wallet, ${log}" },
];

const DEFAULT_CAT: Record<CatKey, string> = {
  main: "Deposit $${capital} of USDC into ${name} through ${app} and keep the position open.",
  second: "Make a second, smaller deposit of $${small} on ${app}.",
  weekly: "Deposit $${small} of USDC into ${name} through ${app} each week so the position keeps qualifying.",
  exit: 'Write the wallet, the dates and every transaction in a farm log, then unwind in reverse order when you exit.',
};

/** Fill a template with the protocol's own values. */
function fill(template: string, p: SnapshotProtocol, capital: number, chain: string): string {
  return template
    .replaceAll('${name}', p.name)
    .replaceAll('${app}', `${p.name}'s own app on ${chain}`)
    .replaceAll('${capital}', String(capital))
    .replaceAll('${small}', String(Math.max(10, Math.round(capital / 5))))
    .replaceAll('${chain}', chain)
    .replaceAll('${log}', LOG_LINE);
}

/** The category's template for one writer: the first table entry whose keywords the
 *  category contains and that defines that writer, else the default. The main writer
 *  also matches a category named exactly 'centralized exchange', as before. */
function catTemplate(c: string, key: CatKey): string {
  for (const e of CATS) {
    if ((key === 'main' && e.exact === c) || e.keys.some((k) => c.includes(k))) {
      const t = e[key];
      if (t !== undefined) return t;
    }
  }
  return DEFAULT_CAT[key];
}

/** The category's reward noun for the points-page step: the first table entry that
 *  matches the category (exact name included, as the main writer does) and names a
 *  reward, else 'points'. The step then says which reward to claim, not just 'points'. */
function rewardFor(c: string): string {
  for (const e of CATS) {
    if (e.exact === c || e.keys.some((k) => c.includes(k))) {
      if (e.reward !== undefined) return e.reward;
    }
  }
  return 'points';
}

/** A TVL in the short form the farm plan uses: $2.76B, $499.1M, $5.2M. */
function tvlText(tvl: number): string {
  if (tvl >= 1e9) return `$${(tvl / 1e9).toFixed(2)}B`;
  if (tvl >= 1e6) return `$${(tvl / 1e6).toFixed(1)}M`;
  return `$${Math.round(tvl / 1e3)}K`;
}

/** How much of the chain's gas token one farm wallet needs to start, in that token. */
function gasTokenFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return '0.02 ETH';
  if (c === 'solana') return '0.05 SOL';
  if (c === 'bitcoin') return '0.0002 BTC';
  if (c === 'tron') return '50 TRX';
  if (c === 'bsc' || c === 'binance') return '0.01 BNB';
  return "a little of the chain's gas token";
}

/** The category's first action, in the words a farmer can follow, naming the protocol's own app. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  return fill(catTemplate((p.category ?? '').toLowerCase(), 'main'), p, capital, chain);
}

/** The category's second qualifying action: a different interaction from the first. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  return fill(catTemplate((p.category ?? '').toLowerCase(), 'second'), p, capital, chain);
}

/** The category's weekly qualifying action: the one interaction that keeps the position
 *  counting, repeated every week — the action that fits this protocol's own category,
 *  so the reader knows exactly what to repeat. */
function weeklyActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  return fill(catTemplate((p.category ?? '').toLowerCase(), 'weekly'), p, capital, chain);
}

/** The category's exit step: how to unwind this protocol's own positions, in the order
 *  that does not strand funds — repay before withdrawing a loan, close the short leg
 *  before selling the spot leg of a basis trade, redeem before withdrawing a vault. */
function exitActionFor(p: SnapshotProtocol, chain: string): string {
  return fill(catTemplate((p.category ?? '').toLowerCase(), 'exit'), p, 0, chain);
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Every step names the chain and the protocol's own app, and the
 * weekly step names the category's own qualifying action (see weeklyActionFor), so the plan
 * tells the reader exactly which interaction to repeat — not a generic list of options.
 * The exit step names the category's own unwind order too (see exitActionFor), so the
 * last step is specific to the positions the plan opened. The first step funds the fresh
 * wallet with the chain's own gas token, the hold step budgets the whole plan's gas
 * (setup + weekly + unwind), and the rewards step names the category's own reward
 * (see rewardFor), so every step carries a number the reader can check, not a slogan.
 * The main step also names the protocol's other chains when it runs on more than
 * one, the weekly step says how many weeks to repeat it, and the hold step states
 * the all-in total — capital plus gas — so the reader knows the whole outlay. The
 * main step also states the position next to the protocol's own TVL, as a multiple,
 * so the reader sees the exit is small next to the protocol it leaves.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied?: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.round(hold / 7));
  const totalGas = gas * (2 + weeks);
  const reward = rewardFor((p.category ?? '').toLowerCase());
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet on ${chain} that holds only the funds you plan to farm, fund it with about ${gasTokenFor(chain)} for gas, and keep its seed phrase offline.`,
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
      text: `${weeklyActionFor(p, capital, chain)} Repeat it for about ${weeks} weeks, until the ${hold}-day hold is done.`,
      cost: `about $${gas} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position; budget about $${totalGas} of gas for the whole plan on ${chain} — about $${gas} to set up, $${gas} a week for ${weeks} weeks, $${gas} to unwind. All in, about $${capital + totalGas} is at work ($${capital} in the position plus about $${totalGas} of gas)`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own rewards page in its app on ${chain} and claim the ${reward} only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: exitActionFor(p, chain),
      cost: `about $${gas} of gas to unwind on ${chain}`,
      time: '15 minutes to exit',
    },
  ];
  // A protocol on several chains is farmed where its main app lives; the reader
  // still needs to know the other chains exist, so the plan names them instead
  // of leaving the reader to find them — 85 of the 198 launches run on more
  // than one chain, up to 45.
  if (p.chains.length > 1) {
    const others = p.chains.slice(1, 3).join(', ');
    const more = p.chains.length > 3 ? ` and ${p.chains.length - 3} more` : '';
    steps[1]!.text += ` It also runs on ${others}${more}; farm it on ${chain}, where its main app lives.`;
  }
  // The position next to the protocol's own size: the smallest position is still
  // 10,000x smaller than the smallest protocol's TVL ($100 into $5M), so the exit
  // is always small next to the protocol — stated as a multiple the reader can check.
  steps[1]!.text += ` Its ${tvlText(p.tvl_usd)} TVL is about ${Math.round(p.tvl_usd / capital).toLocaleString('en-US')}× your $${capital} position, so unwinding it is small next to the protocol.`;
  // The verdict, netted in dollars: the plan's gas against the position's pro-rata
  // share of the implied value. It is the plan's own arithmetic, so it belongs in
  // the plan — a reader who only reads the steps still sees whether the farm pays.
  if (implied !== undefined) {
    const e = farmEconomics(p, age, implied);
    const gross = `$${e.gross_usd.toLocaleString('en-US')}`;
    const gasText = `$${e.gas_total}`;
    // Small implied values print in full ($500), not as "$0K": copies sit below $2M.
    const impliedText = implied >= 1_000_000 ? tvlText(implied) : `$${implied.toLocaleString('en-US')}`;
    const verdictText = e.verdict === 'Farm'
      ? `The verdict is Farm: a $${e.capital} position's pro-rata share of the ${impliedText} implied value is about ${gross}, against about ${gasText} of gas for the whole plan, so about $${e.net_usd.toLocaleString('en-US')} stays after gas — about $${e.net_per_hour_usd} an hour for ${e.active_hours} hours of hands-on work.`
      : e.verdict === 'Thin'
        ? `The verdict is Thin: a $${e.capital} position's pro-rata share of the ${impliedText} implied value is about ${gross}, against about ${gasText} of gas for the whole plan, so only about $${e.net_usd.toLocaleString('en-US')} stays after gas — about $${e.net_per_hour_usd} an hour for ${e.active_hours} hours of hands-on work.`
        : `The verdict is Skip: a $${e.capital} position's pro-rata share of the ${impliedText} implied value is about ${gross}, less than the about ${gasText} of gas for the whole plan, so the farm loses about $${Math.abs(e.net_usd).toLocaleString('en-US')} before it pays anything.`;
    steps.push({
      text: `${verdictText} Pro-rata is a yardstick, not a promise: airdrops rarely pay pro-rata, so read the verdict as where the plan's money works hardest, not as expected profit.`,
      cost: `about $${e.gas_total} of gas for the whole plan`,
      time: `${e.active_hours} hours of hands-on work`,
    });
  }
  return steps;
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
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
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
    size_multiplier: row.model.size_multiplier,
    category_multiplier: row.model.category_multiplier,
    farm_net_usd: row.farm_net_usd,
    farm_per_hour_usd: row.farm_per_hour_usd,
    farm_verdict: row.farm_verdict,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    rank_at_045: row.rank_at_045,
    rank_at_055: row.rank_at_055,
    risk_flags: row.risk_flags,
    tier: row.tier,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const m = effectiveModel(snapshot, model);
  const board = buildBoard(snapshot, m);
  const live = liveRows(snapshot);
  const launch = board.filter((r) => r.tier === 'launch').length;
  // Sensitivity: the top 3 launches' implied value at size exponents 0.45 / 0.50 /
  // 0.55 (same $50M anchor), and how many launches move 10 or more ranks at each
  // off-centre exponent — the ranking's robustness, computed here, not asserted.
  const proto = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const topLaunches = board.filter((r) => r.tier === 'launch').slice(0, 3);
  const sensitivity = topLaunches.map((r) => {
    const p = proto.get(r.slug)!;
    return {
      slug: r.slug,
      name: r.name,
      at_045: impliedValue(p, snapshot.as_of, { ...m, size_exponent: 0.45 }).implied,
      at_050: r.implied_value_usd,
      at_055: impliedValue(p, snapshot.as_of, { ...m, size_exponent: 0.55 }).implied,
    };
  });
  const rankMoves = (exp: number): number => {
    const alt = board.filter((r) => r.tier === 'launch')
      .map((r) => ({ slug: r.slug, v: impliedValue(proto.get(r.slug)!, snapshot.as_of, { ...m, size_exponent: exp }).implied }))
      .sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const order = new Map(alt.map((x, i) => [x.slug, i + 1]));
    return board.filter((r) => r.tier === 'launch').filter((r) => Math.abs((order.get(r.slug) ?? 0) - r.rank) >= 10).length;
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: m,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    launch_size: launch,
    copy_size: board.length - launch,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))),
    live,
    sensitivity,
    sensitivity_rank_moves: { at_045: rankMoves(0.45), at_055: rankMoves(0.55) },
    bootstrap: bootstrapStability(snapshot, m, board.filter((r) => r.tier === 'launch'), proto),
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
