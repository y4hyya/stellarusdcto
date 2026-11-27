# Usage stats

Transfers that carry the public `stablehops` tag, counted from public chain data.
Generated 2026-11-27T15:12:21.019Z. Counting starts 2026-11-16; nothing earlier carries the tag.

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
| Base | ok | 2026-11-27T14:47:21.000Z |  |
| Ethereum | ok | 2026-11-27T14:47:11.000Z |  |
| Solana | ok | 2026-11-27T15:02:24.692Z |  |
| Arbitrum | behind | 2026-11-24T22:00:40.000Z |  |
| Avalanche | ok | 2026-11-27T14:47:21.000Z |  |
| OP Mainnet | ok | 2026-11-27T14:47:19.000Z |  |
| Polygon PoS | ok | 2026-11-27T14:47:20.000Z |  |
| Unichain | ok | 2026-11-27T14:47:19.000Z |  |
| Linea | ok | 2026-11-27T14:52:45.000Z |  |
| World Chain | ok | 2026-11-27T14:47:21.000Z |  |
| Ink | ok | 2026-11-27T14:47:19.000Z |  |
| Sonic | ok | 2026-11-27T14:46:57.000Z |  |
| Monad | ok | 2026-11-27T14:47:24.000Z |  |
| Sei | ok | 2026-11-27T14:47:20.000Z |  |
| HyperEVM | ok | 2026-11-27T14:47:20.000Z |  |
| Injective | ok | 2026-11-27T14:47:19.000Z |  |
| Cronos | ok | 2026-11-27T14:47:19.000Z |  |
| Plasma | ok | 2026-11-27T14:47:21.000Z |  |
| Plume | ok | 2026-11-27T14:47:21.000Z |  |
| Codex | error | never | HTTP 429 from rpc.codex.xyz |
| Morph | ok | 2026-11-27T14:47:11.000Z |  |
| EDGE | ok | 2026-11-27T13:54:53.000Z |  |
| Pharos | ok | 2026-11-27T14:47:06.000Z |  |
| XDC | ok | 2026-11-27T14:50:16.000Z |  |
| X Layer | ok | 2026-11-27T14:47:21.000Z |  |
| Stellar | ok | 2026-11-27T15:03:01.994Z |  |

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
