# Token Radar — token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/alditsanz/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/alditsanz/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, ranks
every protocol that records no token (342) by what its launch would be worth, and
hands in a dashboard a reader can use — board, detail view per protocol, filters,
and a farm plan for each one.

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
  replacement 200 times, the curve and the category factors refitted each time.
  Ranks 1, 2 and 3 keep their exact rank in all 200 resamples; the typical
  top-20 launch stays in the top 20 in 100% of resamples (weakest, rank 20,
  74%); across all 198 launches the median rank move is 3 places. The size
  slope itself refits at 0.524, with a 90% interval of 0.363–0.653 — the
  model's 0.50 sits inside it. But the ranking is not bulletproof to the
  exponent: at the ends of that interval 8 launches move 10 or more ranks at
  0.363 and 23 at 0.653 — the top of the board is solid, the middle moves.
  Every row also shows its own rank at exponents 0.45 and 0.55 (the Stability
  column, sortable — the "what the model is most sure about" view), its own
  median rank move across the 200 resamples in the detail view (11 launches
  move a median of 0 places, 50 move 6 or more — the middle of the board moves
  far more under resampling than under the exponent alone), and its
  factual watch-outs in the detail view: one chain only, shrinking TVL,
  listed under 90 days ago, no listing date on record.
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
chains, TVL, age): a fresh wallet funded with the chain's own gas token, the
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
says so in the step itself. Hands-on hours count setup (30 minutes), claiming
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
  view; the page recomputes every row's implied value from the snapshot figures
  and checks it against board.json; watchlist rows wear a ★ badge, the count line
  shows the filtered set's median, total and farm-verdict counts, the Farm net
  column sorts the board by dollars per hour of hands-on work, and the Live tab shows each live
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
