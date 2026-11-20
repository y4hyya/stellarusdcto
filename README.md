# Usage stats

Transfers that carry the public `stablehops` tag, counted from public chain data.
Generated 2026-11-20T14:09:21.161Z. Counting starts 2026-11-16; nothing earlier carries the tag.

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
| Base | ok | 2026-11-20T13:44:21.000Z |  |
| Ethereum | ok | 2026-11-20T13:44:11.000Z |  |
| Solana | error | never | HTTP 429 from api.mainnet-beta.solana.com |
| Arbitrum | behind | 2026-11-19T20:23:27.000Z |  |
| Avalanche | ok | 2026-11-20T13:44:11.000Z |  |
| OP Mainnet | ok | 2026-11-20T13:44:21.000Z |  |
| Polygon PoS | ok | 2026-11-20T13:44:22.000Z |  |
| Unichain | ok | 2026-11-20T13:44:20.000Z |  |
| Linea | ok | 2026-11-20T13:49:03.000Z |  |
| World Chain | ok | 2026-11-20T13:44:21.000Z |  |
| Ink | ok | 2026-11-20T13:44:21.000Z |  |
| Sonic | ok | 2026-11-20T13:39:56.000Z |  |
| Monad | ok | 2026-11-20T13:44:19.000Z |  |
| Sei | ok | 2026-11-20T13:44:18.000Z |  |
| HyperEVM | ok | 2026-11-20T13:44:20.000Z |  |
| Injective | ok | 2026-11-20T13:44:19.000Z |  |
| Cronos | ok | 2026-11-20T13:44:20.000Z |  |
| Plasma | ok | 2026-11-20T13:44:21.000Z |  |
| Plume | ok | 2026-11-20T13:44:23.000Z |  |
| Codex | ok | 2026-11-20T13:44:21.000Z |  |
| Morph | ok | 2026-11-20T13:44:42.000Z |  |
| EDGE | ok | 2026-11-20T12:28:48.000Z |  |
| Pharos | ok | 2026-11-20T13:44:26.000Z |  |
| XDC | ok | 2026-11-20T13:50:42.000Z |  |
| X Layer | ok | 2026-11-20T13:44:21.000Z |  |
| Stellar | ok | 2026-11-20T13:59:58.648Z |  |

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
