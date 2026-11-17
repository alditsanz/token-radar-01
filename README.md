# Token Radar — token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/alditsanz/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/alditsanz/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, ranks
every protocol that records no token (342) by what its launch would be worth, and
hands in a dashboard a reader can use — board, detail view per protocol, filters,
and a farm plan for each one.

## The model (radar-3)

Implied value follows only from the snapshot's own figures — TVL, seven-day growth
and age with no token. No protocol name is special-cased:

```
implied = round( tvl_usd × 0.30
               × min(1.6, max(0.5, 1 + clamp(change_7d, -80, 200) / 100 × 0.8 up / 1.2 down))
               × (0.6 + 0.4 × ln(1 + min(age_days, 1095)) / ln(1 + 1095)) )
```

- **TVL × 0.30** — a launch is worth a share of the value already locked in.
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
on its chain, weekly activity, a hold of 45–90 days with the whole plan's gas
budgeted (setup + weekly + unwind), a rewards-page check naming the category's
own reward, and the category's own exit order. Each step states its cost and
time, including chain-specific gas.

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
- `lib/model.ts` — the radar-3 model, the farm plans, the board checks.
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
