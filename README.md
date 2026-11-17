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
- **Copies at 2%** — wrapped, staked and bridged products of tokens that already
  trade use the same formula at a 2% weight, rescaled so the largest copy stays
  below the smallest launch. They rank at the bottom, because a copy is not a
  launch of its own.

The board covers the whole watchlist (40/40) plus every other pre-token protocol:
198 launches and 144 copies, 342 rows. Protocols whose token already trades are
set aside in a Live token view with their market caps — a fact, not a model.

## The farm plan

Every row carries seven steps, derived from the protocol's own record (category,
chains, TVL, age): a fresh wallet funded with the chain's own gas token, the
category's main action and a second qualifying action in the protocol's own app
on its chain — naming the protocol's other chains when it runs on more than one
(85 of the 198 launches do) — weekly activity with the number of weeks to repeat
it, a hold of 45–90 days with the whole plan's gas budgeted (setup + weekly +
unwind) and the all-in total stated (capital plus gas), a rewards-page check
naming the category's own reward, and the category's own exit order. Each step
states its cost and time, including chain-specific gas.

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
  and checks it against board.json).
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
