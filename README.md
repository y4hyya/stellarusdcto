# Usage stats

Transfers that carry the public `stablehops` tag, counted from public chain data.
Generated 2026-11-18T14:06:07.502Z. Counting starts 2026-11-16; nothing earlier carries the tag.

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
| Base | ok | 2026-11-18T13:41:07.000Z |  |
| Ethereum | ok | 2026-11-18T13:40:59.000Z |  |
| Solana | error | never | HTTP 429 from api.mainnet-beta.solana.com |
| Arbitrum | error | never | HTTP 429 from arb1.arbitrum.io |
| Avalanche | ok | 2026-11-18T13:41:07.000Z |  |
| OP Mainnet | ok | 2026-11-18T13:41:05.000Z |  |
| Polygon PoS | ok | 2026-11-18T13:41:07.000Z |  |
| Unichain | error | 2026-11-18T06:26:39.000Z | Your IP has exceeded its request rate limit. |
| Linea | ok | 2026-11-18T13:39:02.000Z |  |
| World Chain | ok | 2026-11-18T13:41:05.000Z |  |
| Ink | ok | 2026-11-18T13:41:06.000Z |  |
| Sonic | ok | 2026-11-18T13:43:24.000Z |  |
| Monad | ok | 2026-11-18T13:41:08.000Z |  |
| Sei | ok | 2026-11-18T13:41:06.000Z |  |
| HyperEVM | ok | 2026-11-18T13:41:05.000Z |  |
| Injective | ok | 2026-11-18T13:41:06.000Z |  |
| Cronos | ok | 2026-11-18T13:40:55.000Z |  |
| Plasma | ok | 2026-11-18T13:41:07.000Z |  |
| Plume | ok | 2026-11-18T13:41:08.000Z |  |
| Codex | behind | 2026-11-16T22:09:01.000Z |  |
| Morph | ok | 2026-11-18T13:40:36.000Z |  |
| EDGE | ok | 2026-11-18T13:18:30.000Z |  |
| Pharos | ok | 2026-11-18T13:41:39.000Z |  |
| XDC | ok | 2026-11-18T13:40:49.000Z |  |
| X Layer | ok | 2026-11-18T13:41:07.000Z |  |
| Stellar | ok | 2026-11-18T13:57:46.144Z |  |

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
