# Usage stats

Transfers that carry the public `stablehops` tag, counted from public chain data.
Generated 2026-11-24T16:00:33.649Z. Counting starts 2026-11-16; nothing earlier carries the tag.

|  |  |
| --- | --- |
| Transfers | 0 |
| Volume (USDC) | 0 |
| Unique wallets | 0 |
| Rescues | 0 (0 USDC) |

A rescue is a transfer finished here that was started somewhere else.
Unique wallets are distinct signing addresses; one person with wallets on two
chain families counts twice.

## Routes

| From | To | Transfers | Volume (USDC) |
| --- | --- | --- | --- |

## Coverage

Each chain is read through a public RPC. A chain that is behind or in error is
caught up by a later run; its transfers are missing from the totals until then.

| Chain | Status | Scanned through | Note |
| --- | --- | --- | --- |
| Base | ok | 2026-11-24T15:36:45.000Z |  |
| Ethereum | ok | 2026-11-24T15:36:35.000Z |  |
| Solana | ok | 2026-11-24T15:55:05.915Z |  |
| Arbitrum | error | never | HTTP 429 from arb1.arbitrum.io |
| Avalanche | ok | 2026-11-24T15:36:25.000Z |  |
| OP Mainnet | ok | 2026-11-24T15:36:45.000Z |  |
| Polygon PoS | ok | 2026-11-24T15:36:46.000Z |  |
| Unichain | ok | 2026-11-24T15:36:44.000Z |  |
| Linea | ok | 2026-11-24T15:38:05.000Z |  |
| World Chain | ok | 2026-11-24T15:36:45.000Z |  |
| Ink | ok | 2026-11-24T15:36:45.000Z |  |
| Sonic | ok | 2026-11-24T15:33:21.000Z |  |
| Monad | ok | 2026-11-24T15:36:43.000Z |  |
| Sei | ok | 2026-11-24T15:38:31.000Z |  |
| HyperEVM | ok | 2026-11-24T15:36:44.000Z |  |
| Injective | ok | 2026-11-24T15:36:50.000Z |  |
| Cronos | ok | 2026-11-24T15:36:42.000Z |  |
| Plasma | ok | 2026-11-24T15:36:45.000Z |  |
| Plume | ok | 2026-11-24T15:36:46.000Z |  |
| Codex | ok | 2026-11-24T15:36:45.000Z |  |
| Morph | ok | 2026-11-24T15:35:55.000Z |  |
| EDGE | ok | 2026-11-24T15:11:24.000Z |  |
| Pharos | ok | 2026-11-24T15:36:38.000Z |  |
| XDC | ok | 2026-11-24T15:40:37.000Z |  |
| X Layer | ok | 2026-11-24T15:36:46.000Z |  |
| Stellar | ok | 2026-11-24T15:52:21.770Z |  |

## Gaps

Stretches that could not be read at all and cannot be read later, because the
node no longer keeps them. Transfers inside them may be missing from the totals.

None recorded.

## Files

- `stats.json`: the totals above, as the stats page reads them.
- `transfers.jsonl`: every counted burn, one per line, with its transaction hash.
- `mints.jsonl`: every tagged mint on Stellar.
- `checkpoints.json`: where each chain was last read up to.

Everything here is produced by `scripts/stats/collect.ts` on the main branch, which
uses no keys. Running it yourself gives the same numbers.
