# Token Radar — token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/alditsanz/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/alditsanz/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, ranks
every protocol that records no token (342) by what its launch would be worth, and
hands in a dashboard a reader can use — board, detail view per protocol, filters,
and a farm plan for each one. Every row also carries the odds it ever lists a
token, fitted from the snapshot's own record, and the expected value those odds
make with the implied value; the dashboard's first screen accounts for all 758
protocols in the snapshot, not just the 342 on the board.

## The model (radar-4)

Implied value follows only from the snapshot's own figures — TVL, seven-day growth,
age with no token and category. No protocol name is special-cased:

```
implied = round( tvl_usd × 0.30 × (50,000,000 / tvl_usd)^0.5
               × min(1.6, max(0.5, 1 + clamp(change_7d, -80, 200) / 100 × 0.8 up / 1.2 down))
               × (0.6 + 0.4 × ln(1 + min(age_days, 1095)) / ln(1 + 1095))
               × category factor )
```

- **TVL × 0.30, square-root size** — a launch is worth a share of the value
  already locked in, but the share shrinks as the protocol grows. The snapshot's
  own 128 live-token protocols trade at a median 0.89× TVL at $5–10M of TVL,
  0.37× at $10–32M, 0.21× at $33–95M and 0.05× above $108M — a 17× fall. A
  log-log fit of market cap on TVL gives a slope of 0.52 (0.58 after trimming 10
  outliers, 0.42 from the quartile medians), so value grows with the square root
  of TVL, anchored on the snapshot's own $50M floor. The old linear 0.30×
  overvalued the giants about 6× and undervalued the smallest protocols about 3×.
  Bigger is still worth more, and faster-growing is still worth more — the curve
  only stops pretending the share is constant.
- **Growth, asymmetric and bounded** — rising TVL lifts value at 0.8×; falling TVL
  cuts it at 1.2×. A shrinking protocol hurts more than a growing one helps. The
  multiplier itself is bounded to 0.5×–1.6×: the TVL already records the week's
  move, so one bad week never erases more than half the value that remains, and
  one good week never adds more than 60% on top of a TVL that already includes
  the spike. The old unbounded term valued one protocol down 73% in a week at
  13% of its remaining TVL (rank 196, TVL-rank 86) and one up 4,448% in a week
  at 260% (rank 33); the bound moves them to ranks 132 and 46. The top 3 and
  USDD at rank 5 are unchanged — their weeks were ordinary.
- **Age, logarithmic** — longer with no token means more pent-up value, rising fast
  then levelling off. Unknown age counts as 365 days.
- **Category, fitted small** — each category pays a little more or less than the
  size curve alone says, fitted from the snapshot's own live protocols: for every
  category with at least 5 live rows, the median log market-cap against the size
  curve, centred on the typical protocol, shrunk toward 1 by n/(n+10) and clamped
  to 0.80–1.25×. Lending 0.80×, Yield 0.84×, RWA 1.14×, Basis Trading 1.19×;
  every other category 1.00×. Categories with fewer live rows get no factor —
  one live row is noise, not a signal (Prediction Market's single live row sits
  576× off the curve). The fit is computed from the snapshot on every run, never
  hand-set. Growth and age were checked the same way after the size curve and
  barely move market cap (r = −0.15 and −0.05), so both stay small bounded
  adjustments, never the driver.
- **Checked against the market** — the same curve predicts the snapshot's own 128
  live-token protocols' market caps with a median error of ×3.7: 43 of the 128
  land within 2× of their market cap, 57 within 3×, and the median live protocol
  sits at 0.92× the curve, so the curve is centred on the typical protocol.
  Market caps scatter widely at any TVL (the median absolute log error is 1.31),
  so no choice of size exponent beats 0.50 by more than ~1% and no chain-count or
  quadratic term helps at all — the curve tracks the median protocol, which is
  what a ranking needs, not any single one. The Live tab carries each live
  protocol's own market-cap/TVL ratio, so the reader sees the shrinking share
  with their own eyes.
- **Blind test** — the curve is proven on protocols it never saw: split the 128
  live protocols in half by a deterministic parity of the slug, fit the log-log
  curve on one half and predict the other, both ways. The held-out median error
  is ×3.5 one way and ×3.6 the other, against ×3.4 in-sample — the curve
  generalises across the live set instead of memorising its training set. The
  fitted slopes on the two halves are 0.59 and 0.45, bracketing the 0.52 fit on
  all 128, so the square-root exponent is not an artefact of one half. The same
  test under a second split — halving the set by the slug's first letter
  (before 'n' vs from 'n' on) instead of by its letters — lands at ×3.1 and
  ×3.6, so the proof does not rest on one arbitrary way of halving the set.
  (An earlier round halved by FNV-1a hash parity instead: measured, it is the
  char-sum partition with the labels swapped — every one of the 128 live slugs
  falls on the opposite side — so it proved nothing new and was replaced.)
- **Bootstrap: how solid is the ranking?** — the 128 live protocols drawn with
  replacement 1,000 times, the curve and the category factors refitted each time.
  Ranks 1, 2 and 3 keep their exact rank in all 1,000 resamples; the typical
  top-20 launch stays in the top 20 in 100% of resamples (weakest, rank 20,
  71%); across all 198 launches the median rank move is 3 places. The size
  slope itself refits at 0.524, with a 90% interval of 0.363–0.653 — the
  model's 0.50 sits inside it. But the ranking is not bulletproof to the
  exponent: at the ends of that interval 8 launches move 10 or more ranks at
  0.363 and 23 at 0.653 — the top of the board is solid, the middle moves.
  Every row also shows its own rank at exponents 0.45 and 0.55 (the Stability
  column, sortable — the "what the model is most sure about" view), its own
  median rank move across the 1,000 resamples in the detail view and in the
  board's own sortable Resampled column (11 launches move a median of 0 places,
  46 move 6 or more — the middle of the board moves far more under resampling
  than under the exponent alone), and its
  factual watch-outs in the detail view: one chain only, shrinking TVL,
  listed under 90 days ago, no listing date on record.
- **Token odds, from the peers' record** — every row also carries the chance it
  ever lists a token, fitted from the same snapshot's own record: of the 758
  protocols, 416 already have a token, and among the dated ones the share that
  has a token rises with age — 32% in the first 90 days, 41% by one year, 55%
  at two to three years — and levels at a plateau of 78% past three years. A
  row's odds are the share of that plateau still ahead of it at its age,
  (plateau − F(age)) / (1 − F(age)) on a log-age-interpolated curve, adjusted
  by per-category odds ratios (shrunk by n/(n+20), clamped to 0.60–1.67×, only
  where a category holds 10 or more protocols); rows with no listing date get
  the no-date record's own odds (3%). The result runs from 0.746 for the
  youngest rows down to the 0.02 floor past the plateau. **Expected value** —
  implied × odds — is printed under every implied value on the board and in
  the detail view; the board still ranks by implied value, and the farm
  verdicts still net against it. The page recomputes each row's odds from the
  published fit and checks them against board.json, like the value. Checked
  like the value curve: fitted on one part of the snapshot and scored on the
  rest by log-loss across five splits (slug parity both ways, first letter
  both ways, older-listed fitted to newer-listed), the odds model errs at
  0.636 against 0.720 for the snapshot-wide rate and 0.659 for the age curve
  alone; under a category-block bootstrap (300 resamples) the improvement
  over the base rate holds in every resample (90% interval −0.124 to −0.044).
  A chain adjustment was fitted the same way and dropped: it helped the
  parity splits and hurt the letter and time splits. On the time split the
  age curve alone adds nothing — the older half carries almost no young
  protocols to learn from — while the category ratios still help. The odds
  fall as a protocol ages without listing while the value rises with age;
  the two are published side by side, never netted into one number.
- **The census: all 758, accounted for** — the dashboard's first screen states
  the whole snapshot's accounting, counted from the snapshot at build time:
  758 protocols = the 342 with no token on record (the board) + 416 that
  already have a token and are set aside. Of the 416, 128 carry a market cap
  the size curve is fitted on (the 24 largest are on the Live tab); the other
  288 have a token on record but no usable market cap — 272 with no figure at
  all, 15 recorded as $0 and 1 as a −$1 placeholder. (An earlier count of
  "129 with mcap" does not survive contact with the snapshot: 144 carry a
  figure on record, 128 of them positive and usable.)
- **In-category rank, the peer comparison** — every row also carries its rank
  among the launches or copies that share its category, by implied value: the
  board's In category column, sortable so every category's leader comes first
  (33 leaders on the launch tab, 15 on the copy tab), and the detail view states
  it next to the global rank ("In Risk Curators, it ranks #1 of 34 launches by
  implied value"). The value curve is a within-sector comparables curve — a
  category's own live protocols set its factor — so the peer rank is the
  comparison the model itself is built on, not a second ranking. A row alone in
  its category (17 of the 342) says so instead of wearing a #1. The peer rank
  is computed from the snapshot on every run, never hand-set; 325 of the 342
  rows have peers. It is a display of where the row stands among its
  comparables — it does not change the value, the rank, or the verdict.
- **Defaults and bounds, counted** — the model panel also counts how often
  the snapshot is silent and how often the formula's bounds actually bind,
  computed live from the board's own rows: 24 of the 342 rows carry no
  listing date, so their age is scored as the 365-day default (7 of them
  launches); 2 rows have no 7-day change on record, counted as 0%; 6 rows
  sit on a growth bound (5 at the 1.6× cap, 1 at the 0.5× floor) and 1
  row's raw change was clamped into the −80%…+200% band first; 34 rows are
  at or past the 3-year maturity cap, so further age earns them nothing. A
  default or a bound is only honest if its incidence is stated next to it.
- **Likely range** — every row carries a middle-half range for its implied
  value: the 25th to 75th percentile of market-cap / curve among the live
  protocols (0.27×–3.64×). Wide on purpose — market caps scatter widely at any
  TVL — and computed from the snapshot on every run, never hand-set. The
  detail view shows it next to the value.
- **Sensitivity** — the top 3 launches' implied value at size exponents 0.45 /
  0.50 / 0.55, same $50M anchor: Sentora $130.9M / $107.1M / $87.6M, Steakhouse
  $127.1M / $104.1M / $85.2M, Gauntlet $100.5M / $84.5M / $71.1M. Moving the
  exponent moves no launch 10 or more ranks either way — the ranking is set by
  the ordering of TVL, not by the exact exponent.
- **Copies at 2%** — wrapped, staked and bridged products of tokens that already
  trade use the same formula at a 2% weight, rescaled so the largest copy stays
  below the smallest launch. They rank at the bottom, because a copy is not a
  launch of its own.

The board covers the whole watchlist (40/40) plus every other pre-token protocol:
198 launches and 144 copies, 342 rows. Protocols whose token already trades are
set aside in a Live token view with their market caps — a fact, not a model.

## The farm plan

Every row carries eight steps, derived from the protocol's own record (category,
chains, TVL, age): a fresh wallet funded with the chain's own gas token — a
native amount where the chain's token is named (0.02 ETH, 0.05 SOL, 0.01 BNB,
0.0002 BTC, 50 TRX), and the whole plan's gas bill in dollars everywhere else
(135 of the 342 rows run on chains with no named amount, and "a little of the
chain's gas token" told the reader nothing) — the
category's main action and a second qualifying action in the protocol's own app
on its chain — naming the protocol's other chains when it runs on more than one
(85 of the 198 launches do) and stating the position next to the protocol's own
TVL as a multiple, so the reader sees the exit is small next to the protocol —
weekly activity with the number of weeks to repeat
it, a hold of 45–90 days with the whole plan's gas budgeted (setup + the
second action + weekly + unwind) and the all-in total stated (capital plus gas), a rewards-page check
naming the category's own reward, and the category's own exit order. Each step
states its cost and time, including chain-specific gas.

The eighth step is the verdict, netted in dollars: the plan's whole gas bill
against the position's pro-rata share of its implied value (capital / TVL ×
implied). **Farm** means at least $20 stays after gas at $5 or more an hour of
hands-on work; **Thin** means something smaller stays; **Skip** means the gas
costs more than the share. Among the 198 launches: 76 Farm, 41 Thin, 81 Skip
(counts from the built board; copies are all Skip — at a 2% weight their share
is smaller than any plan's gas). The board sorts by Farm net too, so the best
farms per hour sit first: the top farm is Manifest Trade at about $52.63 an
hour (rank 84 by implied value), while rank 1 nets −$71 — a $250 position is a
rounding error next to a $2.76B TVL. Pro-rata is a yardstick for ranking farms,
never a promise of what one pays: airdrops rarely pay pro-rata, and the plan
says so in the step itself. The verdict rests on the point value, and the
point is uncertain — the likely range runs from 0.27× to 3.64× of it — so step
8 also tests the verdict at the range's low end: only 26 of the 76 Farm
verdicts still pay there, and each Farm or Thin row says in its own step 8
whether it holds or rests on the point value. The floor is also a sortable
column on the board, so the 26 Farm verdicts that still pay at the low end
sort to the top. Dollar figures never round to $0: a sub-dollar share prints
to the cent — 144 rows hold a real share of $0.04–$0.62, not $0 (142 of them
printed as exactly "$0" before). The low end is the 25th
percentile of the live scatter, not a worst case — one in four live protocols
sits below it. Hands-on hours count setup (30 minutes), claiming
(10), unwinding (15) and 10 minutes a week — never the hold, which is waiting,
not work.

## Run it

Node 22 or later, standard library only, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That writes `out/board.json` (342 rows), `out/data.js`, `out/dashboard/` and
`out/screenshots/` (3 images), and `out/dossier.json` via
`vendor/makefun-board.ts`. Open `out/dashboard/index.html` in a browser; the
page renders from `data.js` with no network. The program is deterministic: two
runs write identical bytes.

## Files

- `main.ts` — reads the snapshot, builds the board, writes the outputs.
- `lib/model.ts` — the radar-4 model, the farm plans, the board checks.
- `vendor/makefun-board.ts` — the kit's dossier library, unchanged.
- `dashboard/` — `index.html`, `app.css`, `app.js` (sortable, filterable, detail
  view; the page recomputes every row's implied value and token odds from the
  snapshot figures and checks both against board.json; the first screen carries
  the census of all 758 protocols and a proof strip — watchlist 40/40, the blind
  test ×3.5/×3.6, the 1,000-resample stability, the farm-verdict counts — and
  every implied value carries its expected value beneath it; watchlist rows wear a ★ badge, the count line
  shows the filtered set's median, total and farm-verdict counts, the Farm net
  column sorts the board by dollars per hour of hands-on work, the Floor net
  column sorts it by the farm's net at the low end of the likely range, the In
  category column shows each row's rank among the launches or copies that share
  its category (sortable, leaders first), and the Live tab shows each live
  protocol's market-cap/TVL ratio).
- `screenshots/` — 1-board.png, 2-detail.png, 3-filtered.png.
- `LICENSE` — MIT.

## Notes

- The board says a protocol *records no token*, never that it has none: DefiLlama's
  record is not proof, and a protocol on the list may still have a token its
  record does not carry.
- Implied value is this entry's own claim, never a price, and nothing here
  predicts whether or when a token is issued.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=zj6hcknq&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
