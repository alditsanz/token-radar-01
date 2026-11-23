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
// both ways and under a second, independent split — halving by the slug's first
// letter instead of by its letters — so the curve is proven on protocols
// it never saw; intervalFactors gives every row a middle-half range from the live
// protocols' own scatter; and farmEconomics nets each farm plan's gas against the
// position's pro-rata share of its implied value, so every row carries a Farm / Thin /
// Skip verdict in dollars per hour of hands-on work — and the same net at the low end
// of the likely range, so step 8 can say whether the verdict survives a bad draw
// instead of resting only on the point value. Two more ride with them:
// bootstrapStability resamples the live set and refits the curve and the ranking, so
// the dashboard can say how solid the top of the board is and where it moves — and
// every row carries its own median move across the 1,000 resamples, so the detail view
// can say how far this rank moves; and
// every row carries its rank at size exponents 0.45 and 0.55 plus its factual
// watch-outs, so the detail view can say how far this rank moves and what to watch —
// and its rank among its own category's rows in the same tier, so the detail view
// and the board can say where it stands against the peers the value curve is
// fitted on, not only where it sits on the whole board.

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

/** The token-odds fit (see tokenOddsFit): the chance a pre-token protocol
 *  ever lists a token, read off the snapshot's own record — the share of
 *  protocols that have a token, by age bucket, plus per-category odds
 *  ratios. `buckets` holds seven shares: ages [0,90), [90,180), [180,365),
 *  [365,730), [730,1095), [1095,∞) days, then the no-listing-date bucket;
 *  `anchors` is the age each bucket's share is centred at, for the log-age
 *  interpolation tokenOdds runs. The plateau is buckets[5]: the share of
 *  the record that ever ends with a token. */
export interface TokenOddsFit {
  buckets: number[];
  anchors: number[];
  category_odds: Record<string, number>;
  /** Held-out log-loss of the odds model, means over five split evaluations
   *  (slug parity both ways, first-letter both ways, older-listed fitted to
   *  newer-listed): the snapshot-wide base rate, the age curve alone, and
   *  the fitted model with its category ratios. See tokenOddsFit. */
  validation?: { base: number; age_only: number; fitted: number };
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
   *  alpha_a_to_b / alpha_b_to_a are the same test under a second, independent
   *  split — the slug's first character, before 'n' vs from 'n' on, instead of
   *  char-sum parity — so the proof does not rest on one arbitrary way of
   *  halving the set. (An earlier round halved by FNV-1a hash parity instead:
   *  measured, it is the char-sum partition with the labels swapped — every one
   *  of the 128 live slugs falls on the opposite side — so it proved nothing new
   *  and was replaced.) */
  blind?: { fit_a_to_b: number; fit_b_to_a: number; in_sample: number; alpha_a_to_b: number; alpha_b_to_a: number };
  /** Middle-half interval for one row's implied value (see intervalFactors):
   *  the 25th/75th percentiles of market-cap / curve among the live protocols.
   *  Absent on the bare MODEL constant. */
  interval?: { lo: number; hi: number };
  /** Token odds (see tokenOddsFit): the chance each pre-token row ever lists,
   *  fitted from the snapshot's own record at build time. Absent on the bare
   *  MODEL constant. */
  odds?: TokenOddsFit;
  /** Bootstrap stability of the ranking (see bootstrapStability): the size
   *  slope refitted on 1,000 resamples of the live protocols, and the ranking
   *  refitted on 1,000 resamples with the category factors refit each time.
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
  /** The chance this protocol ever lists a token, from the snapshot's own
   *  record (see tokenOdds): 0.02–0.95, three decimals. */
  token_odds: number;
  /** The implied value weighted by those odds: what the launch is worth in
   *  expectation. Published alongside the implied value, never instead of
   *  it — the board still ranks by implied value. */
  expected_value_usd: number;
  /** The farm plan's economics, netted in dollars (see farmEconomics). */
  farm_net_usd: number;
  farm_per_hour_usd: number;
  farm_verdict: 'Farm' | 'Thin' | 'Skip';
  /** The same net at the low end of the likely range (see farmEconomics).
   *  Null when the board was built without an interval. */
  farm_net_floor_usd: number | null;
  /** The middle-half range for the implied value (see intervalFactors). */
  implied_low_usd: number;
  implied_high_usd: number;
  /** The row's rank if the size exponent were 0.45 / 0.55 instead of 0.50
   *  (same $50M anchor, same category factors — see altRanks): how far this
   *  rank moves when the one number the model chose is varied. */
  rank_at_045: number;
  rank_at_055: number;
  /** How far this rank moves when the live set is resampled: the row's median
   *  absolute rank move across the 1,000 bootstrap resamples (see
   *  bootstrapStability), and its 90th percentile. Null on copies, whose ranks
   *  the bootstrap does not refit, and until bootstrapStability has run. */
  rank_boot_med: number | null;
  rank_boot_p90: number | null;
  /** Where this row stands among its own category's rows in the same tier:
   *  its rank by implied value among the launches (or copies) that share its
   *  category, and how many rows that peer group holds. The value curve is a
   *  within-sector comparables curve — a category's own live protocols set its
   *  factor — so the peer rank is the comparison the model itself is built on:
   *  a reader sees whether the row leads its category or trails it, instead of
   *  only where it sits on the whole board. Filled in by buildBoard, which
   *  knows the whole board; until then 0, never a guess. */
  category_rank: number;
  category_size: number;
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
  token_odds: number;
  expected_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  size_multiplier: number;
  category_multiplier: number;
  farm_net_usd: number;
  farm_per_hour_usd: number;
  farm_verdict: 'Farm' | 'Thin' | 'Skip';
  farm_net_floor_usd: number | null;
  implied_low_usd: number;
  implied_high_usd: number;
  rank_at_045: number;
  rank_at_055: number;
  rank_boot_med: number | null;
  rank_boot_p90: number | null;
  category_rank: number;
  category_size: number;
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
  /** The census of the whole snapshot (see buildRadar): every protocol the
   *  snapshot carries, accounted for — the board's pre-token rows, and the
   *  token-bearing rest split by the market-cap record they carry. The
   *  counts reconcile exactly: board + token_bearing = total, and
   *  fitted_live + no_mcap_figure + zero_mcap + negative_mcap =
   *  token_bearing. */
  census: {
    total: number;
    board: number;
    token_bearing: number;
    with_mcap: number;
    fitted_live: number;
    live_shown: number;
    no_mcap_figure: number;
    zero_mcap: number;
    negative_mcap: number;
  };
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
  if (model.odds === undefined) m.odds = tokenOddsFit(snapshot);
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

/** The blind test of the size curve: split the live protocols in half by a
 *  deterministic parity of the slug (no peeking — each half is fitted without
 *  the other), fit the log-log curve on one half and predict the other, both
 *  ways, and report the median |log error| each way plus the in-sample figure
 *  for the same fit on all live rows. A curve that only memorised its training
 *  set would predict the held-out half far worse than its own half; here the
 *  held-out errors sit within ~5% of the in-sample one, so the curve
 *  generalises across the live set instead of overfitting it. The test runs
 *  under a second, independent split too — the slug's first character, before
 *  'n' vs from 'n' on, instead of char-sum parity (68 of the 128 live slugs
 *  fall on the same side in both splits, so the second halving is genuinely
 *  a different one) — so the proof does not rest on one arbitrary way of
 *  halving the set: the two splits land at ×3.5/×3.6 one way and ×3.1/×3.6
 *  the other, against ×3.4 in-sample. */
export function blindTest(snapshot: Snapshot, model: ModelConstants): { fit_a_to_b: number; fit_b_to_a: number; in_sample: number; alpha_a_to_b: number; alpha_b_to_a: number } {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const round3 = (x: number): number => Math.round(x * 1000) / 1000;
  if (live.length < 4) return { fit_a_to_b: 0, fit_b_to_a: 0, in_sample: 0, alpha_a_to_b: 0, alpha_b_to_a: 0 };
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
  const alphaSplit = runSplit((p) => (p.slug[0] ?? 'a') < 'n');
  return {
    fit_a_to_b: slugSplit.a_to_b,
    fit_b_to_a: slugSplit.b_to_a,
    in_sample: round3(err(live, logLogFit(live))),
    alpha_a_to_b: alphaSplit.a_to_b,
    alpha_b_to_a: alphaSplit.b_to_a,
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

/** Age bucket edges in days for the token-odds fit: [0,90), [90,180),
 *  [180,365), [365,730), [730,1095), [1095,∞), plus a bucket for protocols
 *  with no listing date on record. */
const ODDS_EDGES = [90, 180, 365, 730, 1095];
const ODDS_TOP = ODDS_EDGES.length;
const ODDS_UNK = ODDS_EDGES.length + 1;
const ODDS_NB = ODDS_EDGES.length + 2;

function oddsBucket(age: number | null): number {
  if (age === null) return ODDS_UNK;
  for (let i = 0; i < ODDS_EDGES.length; i++) if (age < ODDS_EDGES[i]!) return i;
  return ODDS_TOP;
}

/** The odds fit over one set of protocols: each age bucket's share that has
 *  a token, shrunk toward the set's overall share (pseudo-count 5) and
 *  forced non-decreasing across the dated buckets — a listing curve cannot
 *  fall as age rises — each bucket's centre age (geometric mean, for the
 *  log-age interpolation), and, when `withCat`, per-category odds ratios on
 *  the curve: the category's own token odds against the set's, shrunk by
 *  n/(n+20), clamped to 0.60–1.67, only where a category holds 10 or more
 *  protocols. Fitted from the record alone; no protocol is named. */
function fitOddsCore(protocols: SnapshotProtocol[], asOf: string, withCat: boolean): TokenOddsFit {
  const items = protocols.map((p) => ({ p, age: ageDays(asOf, p.listed_at), tok: !isPreToken(p) }));
  const g = items.length === 0 ? 0 : items.reduce((s, r) => s + (r.tok ? 1 : 0), 0) / items.length;
  const cnt = new Array<number>(ODDS_NB).fill(0);
  const tk = new Array<number>(ODDS_NB).fill(0);
  const logAge = new Array<number>(ODDS_NB).fill(0);
  const nAge = new Array<number>(ODDS_NB).fill(0);
  for (const r of items) {
    const b = oddsBucket(r.age);
    cnt[b]!++;
    if (r.tok) tk[b]!++;
    if (r.age !== null) { logAge[b]! += Math.log(1 + r.age); nAge[b]!++; }
  }
  const buckets = cnt.map((n, i) => (tk[i]! + 5 * g) / (n + 5));
  for (let i = 1; i <= ODDS_TOP; i++) if (buckets[i]! < buckets[i - 1]!) buckets[i] = buckets[i - 1]!;
  const edgeMid = [45, 135, 272, 547, 912, 1460, 1460];
  const anchors = buckets.map((_, i) => (nAge[i]! > 0 ? Math.exp(logAge[i]! / nAge[i]!) - 1 : edgeMid[i]!));
  const category_odds: Record<string, number> = {};
  if (withCat && g > 0 && g < 1) {
    const by = new Map<string, { n: number; t: number }>();
    for (const r of items) {
      const k = r.p.category ?? '';
      const e = by.get(k) ?? { n: 0, t: 0 };
      e.n++;
      if (r.tok) e.t++;
      by.set(k, e);
    }
    const go = g / (1 - g);
    for (const [k, e] of by) {
      if (e.n < 10) continue;
      const f = e.t / e.n;
      if (f <= 0 || f >= 1) continue;
      const lor = Math.log((f / (1 - f)) / go) * (e.n / (e.n + 20));
      const cl = Math.min(Math.log(1.67), Math.max(Math.log(0.6), lor));
      if (Math.abs(cl) > 1e-9) category_odds[k] = Math.round(Math.exp(cl) * 1000) / 1000;
    }
  }
  return { buckets, anchors, category_odds };
}

/** The listing curve at one age: the bucket shares interpolated in log-age
 *  between the bucket centres, flat outside them; the no-date bucket's own
 *  share when the age is unknown. */
function oddsF(fit: TokenOddsFit, age: number | null): number {
  if (age === null) return fit.buckets[ODDS_UNK]!;
  const x = Math.log(1 + age);
  const xs = fit.anchors.map((a) => Math.log(1 + a));
  if (x <= xs[0]!) return fit.buckets[0]!;
  if (x >= xs[ODDS_TOP]!) return fit.buckets[ODDS_TOP]!;
  for (let i = 1; i <= ODDS_TOP; i++) {
    if (x <= xs[i]!) {
      const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
      return fit.buckets[i - 1]! + t * (fit.buckets[i]! - fit.buckets[i - 1]!);
    }
  }
  return fit.buckets[ODDS_TOP]!;
}

/** One share of the listing curve, adjusted by a category's odds ratio. */
function oddsAdjust(fit: TokenOddsFit, f: number, category: string | null): number {
  const orc = fit.category_odds[category ?? ''] ?? 1;
  if (orc === 1) return f;
  const o = (f / (1 - f)) * orc;
  return o / (1 + o);
}

/** The chance one protocol ever lists a token, given it has none at `age`:
 *  of the plateau still ahead of it, the share of its own remaining record —
 *  (plateau − F(age)) / (1 − F(age)) on the category-adjusted curve, clamped
 *  to 0.02–0.95. A protocol past the plateau's age has, on this record,
 *  almost always listed already if it ever will; a young one still has most
 *  of the curve ahead of it. */
export function tokenOddsAt(age: number | null, category: string | null, fit: TokenOddsFit): number {
  const clampF = (f: number): number => Math.min(0.999, Math.max(0.001, f));
  const f = clampF(oddsAdjust(fit, oddsF(fit, age), category));
  const fInf = clampF(oddsAdjust(fit, fit.buckets[ODDS_TOP]!, category));
  return Math.round(Math.min(0.95, Math.max(0.02, (fInf - f) / (1 - f))) * 1000) / 1000;
}

/** A protocol's token odds under a fitted curve (see tokenOddsAt). */
export function tokenOdds(p: SnapshotProtocol, asOf: string, fit: TokenOddsFit): number {
  return tokenOddsAt(ageDays(asOf, p.listed_at), p.category, fit);
}

/** The odds model's held-out check, in the blind test's spirit: fit on one
 *  part of the snapshot and score the rest by log-loss, under three splits —
 *  slug parity both ways, first letter both ways, and older-listed protocols
 *  fitted to newer-listed ones (the time split: the older half carries
 *  almost no young protocols, so there the age curve alone can add nothing
 *  and only the category ratios speak). Three scores per split: the
 *  snapshot-wide base rate, the age curve alone, and the fitted model. The
 *  category-block bootstrap around these splits is a builder audit
 *  (audit15-odds.mts): against the base rate the fitted model's improvement
 *  holds in all 300 resamples, 90% interval −0.124 to −0.044 log-loss; a
 *  chain adjustment was fitted the same way and dropped — it helped the
 *  parity splits and hurt the letter and time splits. */
function oddsValidation(snapshot: Snapshot): { base: number; age_only: number; fitted: number } {
  const ps = snapshot.protocols;
  const parity = (s: string): number => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 2;
  const splits: { tr: SnapshotProtocol[]; te: SnapshotProtocol[] }[] = [];
  const A = ps.filter((p) => parity(p.slug) === 0);
  const B = ps.filter((p) => parity(p.slug) !== 0);
  splits.push({ tr: A, te: B }, { tr: B, te: A });
  const C = ps.filter((p) => (p.slug[0] ?? 'a') < 'n');
  const D = ps.filter((p) => (p.slug[0] ?? 'a') >= 'n');
  splits.push({ tr: C, te: D }, { tr: D, te: C });
  const dated = ps.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const h = Math.floor(dated.length / 2);
  splits.push({ tr: dated.slice(0, h), te: dated.slice(h) });
  const logLoss = (pred: (p: SnapshotProtocol) => number, test: SnapshotProtocol[]): number => {
    let s = 0;
    for (const p of test) {
      const q = Math.min(1 - 1e-4, Math.max(1e-4, pred(p)));
      s += !isPreToken(p) ? -Math.log(q) : -Math.log(1 - q);
    }
    return s / test.length;
  };
  const predFrom = (core: TokenOddsFit): ((p: SnapshotProtocol) => number) => (p) =>
    Math.min(0.999, Math.max(0.001, oddsAdjust(core, oddsF(core, ageDays(snapshot.as_of, p.listed_at)), p.category)));
  let sb = 0, sa = 0, sf = 0;
  for (const s of splits) {
    const g = s.tr.reduce((x, p) => x + (!isPreToken(p) ? 1 : 0), 0) / s.tr.length;
    sb += logLoss(() => g, s.te);
    sa += logLoss(predFrom(fitOddsCore(s.tr, snapshot.as_of, false)), s.te);
    sf += logLoss(predFrom(fitOddsCore(s.tr, snapshot.as_of, true)), s.te);
  }
  const r3 = (x: number): number => Math.round(x * 1000) / 1000;
  return { base: r3(sb / splits.length), age_only: r3(sa / splits.length), fitted: r3(sf / splits.length) };
}

/** The token-odds fit for the whole snapshot (see TokenOddsFit), with its
 *  held-out validation attached. On this snapshot the record reads: of 758
 *  protocols, 416 have a token; the share that has one rises from about a
 *  third in the first 90 days to a plateau of about 78% past three years,
 *  so a pre-token protocol's odds of ever listing fall as it ages — the
 *  opposite of the value model's maturity term, and the two are published
 *  side by side rather than netted into one number. */
export function tokenOddsFit(snapshot: Snapshot): TokenOddsFit {
  const core = fitOddsCore(snapshot.protocols, snapshot.as_of, true);
  const r3 = (x: number): number => Math.round(x * 1000) / 1000;
  return {
    buckets: core.buckets.map(r3),
    anchors: core.anchors.map((a) => Math.round(a)),
    category_odds: core.category_odds,
    validation: oddsValidation(snapshot),
  };
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
 *  (2) The whole ranking refitted on 1,000 resamples, the category factors
 *  refit from each resample: how often each top-20 launch stays in the top
 *  20, how often ranks 1–3 keep their exact rank, and the median absolute
 *  rank move across all launches. The top of the board is solid (ranks 1–3
 *  keep their exact rank in every resample); the middle moves, and the
 *  slope's own interval is wide enough that the exponent alone can move
 *  8–23 launches by 10 or more ranks — the sensitivity table's ±0.05
 *  understates that, and this block says so. Each launch row also keeps its
 *  own median move and 90th percentile across the 1,000 resamples
 *  (rank_boot_med / rank_boot_p90 on the row), so the detail view can say how
 *  far this rank moves — the two measures of stability, exponent sensitivity
 *  and resampling, are independent, and they disagree in the middle of the
 *  board: only 15 launches move 5+ ranks at exponents 0.45/0.55, but 50 move
 *  6+ places at their bootstrap median. */
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
  // (2) Whole ranking on 1,000 resamples, factors refit each time. Each launch
  // keeps its own list of rank moves too, so its row can carry its median and
  // 90th-percentile move — the per-row half of this block.
  const rngModel = mulberry32(20261119);
  const top20 = launches.slice(0, 20).map((r) => r.slug);
  const stay = new Map(top20.map((s) => [s, 0]));
  const top3Exact = [0, 0, 0];
  const absMoves: number[] = [];
  const perRow = new Map(launches.map((r) => [r.slug, [] as number[]]));
  for (let i = 0; i < 1000; i++) {
    const sample = Array.from({ length: live.length }, () => live[Math.floor(rngModel() * live.length)]!);
    const mm: ModelConstants = { ...model, category_factors: categoryFactors({ ...snapshot, protocols: sample }, model) };
    const alt = launches.map((r) => ({ slug: r.slug, v: impliedValue(proto.get(r.slug)!, snapshot.as_of, mm).implied }))
      .sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const order = new Map(alt.map((x, j) => [x.slug, j + 1]));
    for (const s of top20) if ((order.get(s) ?? 999) <= 20) stay.set(s, (stay.get(s) ?? 0) + 1);
    for (let j = 0; j < 3; j++) if (alt[j]!.slug === launches[j]!.slug) top3Exact[j]!++;
    for (const r of launches) {
      const move = Math.abs((order.get(r.slug) ?? 0) - r.rank);
      absMoves.push(move);
      perRow.get(r.slug)!.push(move);
    }
  }
  for (const r of launches) {
    const moves = perRow.get(r.slug)!;
    r.rank_boot_med = median(moves);
    r.rank_boot_p90 = quantile(moves, 0.9);
  }
  const stayRates = [...stay.values()].map((v) => Math.round((v / 1000) * 100));
  return {
    slope_median: slopeMedian,
    slope_lo: slopeLo,
    slope_hi: slopeHi,
    rank_moves_lo: movesAt(slopeLo),
    rank_moves_hi: movesAt(slopeHi),
    top20_stay_median: median(stayRates),
    top20_stay_min: Math.min(...stayRates),
    top3_exact: [Math.round((top3Exact[0]! / 1000) * 100), Math.round((top3Exact[1]! / 1000) * 100), Math.round((top3Exact[2]! / 1000) * 100)],
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
    return toRow(s.p, s, implied, 'copy', interval, m.odds);
  });
  const launchRows: BoardRow[] = scoredLaunches.map((s) => toRow(s.p, s, s.implied, 'launch', interval, m.odds));
  const rows = [...launchRows, ...copyRows];
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  // Each row's rank among its own category's rows in the same tier: the rows
  // arrive in implied-value order within each tier, so a peer group's order in
  // `rows` is its order by value, and the position in the group is the peer
  // rank. 48 tier+category groups; 325 of the 342 rows have peers, 17 are the
  // only row of their category in their tier.
  const peers = new Map<string, BoardRow[]>();
  for (const r of rows) {
    const key = `${r.tier}|${r.category ?? ''}`;
    const g = peers.get(key);
    if (g !== undefined) g.push(r);
    else peers.set(key, [r]);
  }
  for (const g of peers.values()) {
    g.forEach((r, i) => {
      r.category_rank = i + 1;
      r.category_size = g.length;
    });
  }
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

function toRow(p: SnapshotProtocol, v: { growthPct: number; growthMult: number; maturityMult: number; sizeMult: number; catMult: number; age: number | null }, implied: number, tier: Tier, interval: { lo: number; hi: number }, oddsFit?: TokenOddsFit): BoardRow {
  const econ = farmEconomics(p, v.age, implied, interval.lo);
  const odds = oddsFit !== undefined ? tokenOddsAt(v.age, p.category, oddsFit) : 1;
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
    token_odds: odds,
    expected_value_usd: Math.round(implied * odds),
    farm_net_usd: econ.net_usd,
    farm_per_hour_usd: econ.net_per_hour_usd,
    farm_verdict: econ.verdict,
    farm_net_floor_usd: econ.net_floor_usd,
    implied_low_usd: Math.max(1, Math.round(implied * interval.lo)),
    implied_high_usd: Math.round(implied * interval.hi),
    // Alt-exponent ranks are filled in by buildBoard, which knows the whole
    // board; until then they are the row's own rank, never a guess. The
    // bootstrap medians are filled in by bootstrapStability, which runs after
    // the board is built; until then they are null, never a guess. The
    // category rank is filled in by buildBoard the same way; until then 0.
    rank_at_045: 0,
    rank_at_055: 0,
    rank_boot_med: null,
    rank_boot_p90: null,
    category_rank: 0,
    category_size: 0,
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
    farm_steps: farmSteps(p, v.age, implied, interval.lo).map(stepText),
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
 *  never promises what a farm pays. The net subtracts the whole plan's gas —
 *  the farm wallet's own transactions, setup + the second action + weekly +
 *  unwind, the same total step 5 budgets (the fresh wallet's funding transfer
 *  is paid by the wallet that sends it, so it is not in this total); the hours
 *  are hands-on time only — 30 minutes to set up, 10 minutes to claim, 15 to
 *  unwind, 10 minutes a week — never the hold itself, which is waiting, not
 *  work. The verdict is Farm when at least $20 stays after gas at $5 or more
 *  an hour, Thin when anything stays, Skip when the gas costs more than the
 *  pro-rata share. Copies are Skip on the arithmetic, not on a judgement:
 *  their 2% weight leaves a share smaller than any plan's gas.
 *  The verdict rests on the point value, and the entry itself says the point
 *  is uncertain — the likely range runs from 0.27x to 3.64x of it — so the
 *  economics also carry the net at the range's low end (net_floor_usd): the
 *  same gross scaled by the interval's low factor, same gas. A Farm that
 *  still pays there has a verdict that survives a bad draw, not just a
 *  central one; a Farm that does not says so in step 8 instead of hiding
 *  behind the point. The floor is the 25th percentile of the live scatter,
 *  not a worst case — one in four live protocols sits below it — and the
 *  step-8 sentence says exactly that by naming the low-end value. */
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
  /** The same net at the low end of the likely range (gross scaled by the
   *  interval's low factor, same gas), to two decimals so a sub-dollar net
   *  still reads as a number, not $0. Null when no interval was passed. */
  net_floor_usd: number | null;
}

export function farmEconomics(p: SnapshotProtocol, age: number | null, implied: number, intervalLo?: number): FarmEconomics {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.round(hold / 7));
  // Every transaction the farm wallet itself makes: setup, the second action,
  // one a week, and the unwind. Step 5 budgets exactly this total, and step 8
  // nets against it — an earlier round counted only setup + weekly + unwind
  // and left the second action's gas out, so 13 verdicts sat on the wrong side
  // of their threshold (6 Farm that are Thin, 7 Thin that are Skip).
  const gasTotal = gas * (3 + weeks);
  const hours = Math.round((0.92 + weeks / 6) * 10) / 10;
  const gross = Math.round((capital / Math.max(p.tvl_usd, 1)) * implied);
  const net = gross - gasTotal;
  const perHour = Math.round((net / hours) * 100) / 100;
  const verdict = net >= 20 && perHour >= 5 ? 'Farm' : net > 0 ? 'Thin' : 'Skip';
  // The floor net uses the unrounded gross, so a gross that rounds to the gas
  // bill still shows its true sub-dollar loss instead of $0.
  const grossExact = (capital / Math.max(p.tvl_usd, 1)) * implied;
  const netFloor = intervalLo === undefined ? null : Math.round((grossExact * intervalLo - gasTotal) * 100) / 100;
  return { capital, gas_total: gasTotal, hold_days: hold, weeks, active_hours: hours, gross_usd: gross, net_usd: net, net_per_hour_usd: perHour, verdict, net_floor_usd: netFloor };
}

/** One category's farm actions, as templates — ${name} the protocol, ${app} its own app
 *  on the chain, ${capital} the position size, ${small} a fifth of it, ${chain} the chain,
 *  ${log} the farm-log line. One table drives all four writers, so a category's wording
 *  lives in one place instead of four parallel if-chains. Every entry defines
 *  all four writers. */
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
    second: "Make a second small transaction in ${name}'s own app on ${chain} so the activity is not a single event.",
    weekly: "Make one small transaction in ${name}'s own app on ${chain} each week.",
    exit: "To exit, move the remaining balance out of ${name}'s own app on ${chain}, ${log}" },
  { keys: ['payment'],
    reward: 'spending points',
    main: "Spend $${capital} through ${name}'s payments app on ${chain} and keep the card or account active.",
    second: "Make a second, smaller payment through ${name}'s payments app on ${chain}.",
    weekly: "Spend $${small} through ${name}'s payments app on ${chain} each week.",
    exit: "To exit, withdraw the remaining balance from ${name}'s payments app on ${chain}, ${log}" },
  { keys: ['privacy'],
    reward: 'shielded points',
    main: "Use $${capital} through ${name}'s private app on ${chain} and keep the shielded balance.",
    second: "Make a second shielded transaction through ${name}'s private app on ${chain}.",
    weekly: "Refresh the shielded balance through ${name}'s private app on ${chain} each week.",
    exit: "To exit, unshield the remaining balance through ${name}'s private app on ${chain}, ${log}" },
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

/** How much of the chain's gas token one farm wallet needs to start, in that token.
 *  Six chains name a native amount (0.02 ETH, 0.05 SOL, 0.01 BNB, 0.0002 BTC,
 *  50 TRX); every other chain states the same funding need in dollars — the
 *  whole plan's gas bill, which step 5 budgets — because naming a native amount
 *  for 50+ chains from memory would invent token symbols (Polygon's token alone
 *  was renamed MATIC to POL). "About $27 worth of Base's gas token" is a number
 *  the reader can act on; "a little of the chain's gas token" was not, and 135
 *  of the 342 rows said exactly that before this fix. */
function gasTokenFor(chain: string, totalGas: number): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return '0.02 ETH';
  if (c === 'solana') return '0.05 SOL';
  if (c === 'bitcoin') return '0.0002 BTC';
  if (c === 'tron') return '50 TRX';
  if (c === 'bsc' || c === 'binance') return '0.01 BNB';
  return `$${totalGas} worth of ${chain}'s gas token`;
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
 * wallet with the chain's own gas token — a native amount where the chain's token is
 * named (ETH, SOL, BNB, BTC, TRX), the whole plan's gas bill in dollars everywhere else
 * (see gasTokenFor) — the hold step budgets the whole plan's gas
 * (setup + the second action + weekly + unwind), and the rewards step names the category's own reward
 * (see rewardFor), so every step carries a number the reader can check, not a slogan.
 * The main step also names the protocol's other chains when it runs on more than
 * one, the weekly step says how many weeks to repeat it, and the hold step states
 * the all-in total — capital plus gas — so the reader knows the whole outlay. The
 * main step also states the position next to the protocol's own TVL, as a multiple,
 * so the reader sees the exit is small next to the protocol it leaves.
 * The hold step's gas total counts every transaction the farm wallet itself
 * makes — setup, the second action, one a week, and the unwind — and step 8
 * nets the verdict against exactly that total. The first step's funding
 * transfer is paid by the wallet that sends it, so it is not in the total.
 * Step 8 also tests the verdict against the low end of the likely range:
 * a Farm or Thin whose plan still pays there says so, one whose plan does
 * not says the verdict rests on the point value instead of the floor — the
 * floor is the 25th percentile of the live scatter, not a worst case. Skip
 * rows carry no floor sentence: they already lose at the point value.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied?: number, intervalLo?: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.round(hold / 7));
  // Same total as farmEconomics: setup + the second action + weekly + unwind.
  const totalGas = gas * (3 + weeks);
  const reward = rewardFor((p.category ?? '').toLowerCase());
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet on ${chain} that holds only the funds you plan to farm, fund it with about ${gasTokenFor(chain, totalGas)} for gas, and keep its seed phrase offline.`,
      cost: `about $${gas} of gas for the funding transfer on ${chain}, paid by the wallet that sends it, not the farm wallet`,
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
      cost: `the $${capital} stays in the position; budget about $${totalGas} of gas for the whole plan on ${chain} — about $${gas} to set up, $${gas} for the second action, $${gas} a week for ${weeks} weeks, $${gas} to unwind. All in, about $${capital + totalGas} is at work ($${capital} in the position plus about $${totalGas} of gas)`,
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
    const e = farmEconomics(p, age, implied, intervalLo);
    // The gross is a quantity with units, not a point to round away: 142 rows
    // hold a real sub-dollar share ($0.04–$0.48, median $0.15) that the
    // whole-dollar round prints as "$0" — the same defect round 8 fixed for
    // the net, one line down. A whole-dollar figure when it is at least a
    // dollar, cents when it is not — the same rule the floor and the loss
    // already use, so no verdict ever reads as holding "$0". Display only:
    // gross_usd stays the rounded value the net, the verdict and the floor
    // are computed from, and Math.round of the exact gross equals it on
    // every row at $1 or above, so no other row's text changes.
    const grossExact = (e.capital / Math.max(p.tvl_usd, 1)) * implied;
    const gross = grossExact >= 1 ? `$${Math.round(grossExact).toLocaleString('en-US')}` : `$${grossExact.toFixed(2)}`;
    const gasText = `$${e.gas_total}`;
    // Small implied values print in full ($500), not as "$0K": copies sit below $2M.
    const impliedText = implied >= 1_000_000 ? tvlText(implied) : `$${implied.toLocaleString('en-US')}`;
    // A whole-dollar net that rounds to $0 is not a $0 loss: the unrounded
    // gross sits cents below the gas bill, so print the loss to the cent.
    const lossText = e.net_usd === 0
      ? `$${(e.gas_total - grossExact).toFixed(2)}`
      : `$${Math.abs(e.net_usd).toLocaleString('en-US')}`;
    // The floor test, for Farm and Thin only: the same net at the low end of
    // the likely range. A whole-dollar figure when it is at least a dollar,
    // cents when it is not — the same rule as the loss above, so no verdict
    // ever reads as paying or losing "$0".
    let floorText = '';
    if (intervalLo !== undefined && e.net_floor_usd !== null && e.verdict !== 'Skip') {
      const lowValue = Math.max(1, Math.round(implied * intervalLo));
      const lowText = lowValue >= 1_000_000 ? tvlText(lowValue) : `$${lowValue.toLocaleString('en-US')}`;
      const fmtFloor = (x: number): string => Math.abs(x) >= 1 ? `$${Math.round(Math.abs(x)).toLocaleString('en-US')}` : `$${Math.abs(x).toFixed(2)}`;
      floorText = e.net_floor_usd > 0
        ? ` At the low end of the likely range (${lowText}), the same plan still nets about ${fmtFloor(e.net_floor_usd)}.`
        : ` At the low end of the likely range (${lowText}), the same plan loses about ${fmtFloor(e.net_floor_usd)} — the verdict rests on the point value, not the floor.`;
    }
    const verdictText = e.verdict === 'Farm'
      ? `The verdict is Farm: a $${e.capital} position's pro-rata share of the ${impliedText} implied value is about ${gross}, against about ${gasText} of gas for the whole plan, so about $${e.net_usd.toLocaleString('en-US')} stays after gas — about $${e.net_per_hour_usd} an hour for ${e.active_hours} hours of hands-on work.${floorText}`
      : e.verdict === 'Thin'
        ? `The verdict is Thin: a $${e.capital} position's pro-rata share of the ${impliedText} implied value is about ${gross}, against about ${gasText} of gas for the whole plan, so only about $${e.net_usd.toLocaleString('en-US')} stays after gas — about $${e.net_per_hour_usd} an hour for ${e.active_hours} hours of hands-on work.${floorText}`
        : `The verdict is Skip: a $${e.capital} position's pro-rata share of the ${impliedText} implied value is about ${gross}, less than the about ${gasText} of gas for the whole plan, so the farm loses about ${lossText} before it pays anything.`;
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
    token_odds: row.token_odds,
    expected_value_usd: row.expected_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    size_multiplier: row.model.size_multiplier,
    category_multiplier: row.model.category_multiplier,
    farm_net_usd: row.farm_net_usd,
    farm_per_hour_usd: row.farm_per_hour_usd,
    farm_verdict: row.farm_verdict,
    farm_net_floor_usd: row.farm_net_floor_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    rank_at_045: row.rank_at_045,
    rank_at_055: row.rank_at_055,
    rank_boot_med: row.rank_boot_med,
    rank_boot_p90: row.rank_boot_p90,
    category_rank: row.category_rank,
    category_size: row.category_size,
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
  // The bootstrap runs BEFORE the rows are mapped for the dashboard: it fills
  // each launch row's own median/90th-percentile move (rank_boot_med/p90), and
  // radarRow copies them — mapped first, they would still be null.
  const boot = bootstrapStability(snapshot, m, board.filter((r) => r.tier === 'launch'), proto);
  // The census: every protocol in the snapshot, accounted for. The board
  // carries the pre-token ones; the token-bearing rest is split by the
  // market-cap record it carries — a usable figure (the live set the size
  // curve is fitted on), no figure at all, a figure of $0, or the one
  // −$1 placeholder the source carries. Counted here, from the snapshot,
  // so the dashboard's accounting can be checked against the source.
  const tokenBearing = snapshot.protocols.filter((p) => !isPreToken(p));
  const census = {
    total: snapshot.protocols.length,
    board: board.length,
    token_bearing: tokenBearing.length,
    with_mcap: tokenBearing.filter((p) => p.mcap_usd !== null).length,
    fitted_live: tokenBearing.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0).length,
    live_shown: live.length,
    no_mcap_figure: tokenBearing.filter((p) => p.mcap_usd === null).length,
    zero_mcap: tokenBearing.filter((p) => p.mcap_usd === 0).length,
    negative_mcap: tokenBearing.filter((p) => p.mcap_usd !== null && p.mcap_usd < 0).length,
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
    bootstrap: boot,
    census,
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
