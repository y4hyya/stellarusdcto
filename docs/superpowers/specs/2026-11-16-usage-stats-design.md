# Usage stats from on chain tags: design

Date: 2026-11-16

## Intent

The owner wants to see how much the bridge is used (wallets, volume, routes)
and cite those numbers publicly. The product promises no server, no accounts
and no tracking, so the numbers have to come from public chain data alone.

Transfers made here are indistinguishable on chain from any other CCTP usage,
so every transaction the app sends gets a small public tag. A scheduled job
then reads public RPCs, keeps the transactions carrying the tag, and publishes
totals that a `/stats` page renders.

## Decisions made by the owner (2026-11-16)

- A public tag on every transfer is acceptable, with the site saying so.
- The numbers are shown on a public `/stats` page.
- The tag text is `stablehops` (the app will be rebranded later, not now).
- All transfers count, including the owner's own.

## Goals

- Count transfers, USDC volume, unique wallets and route mix for every
  transfer started in the app, on all 26 mainnet chains.
- Count transfers finished here that were started elsewhere (rescues), for
  Stellar destinations first.
- Anyone can rerun the counting job without keys and check any counted
  transfer on an explorer.

## Non goals

- Visitors, drop off, failed attempts. Those need an analytics script.
- History before the tag ships. It cannot be reconstructed.
- Testnet numbers. Testnet carries the tag (same code path) but is not counted.

## Anti goals

- The tag must never be the reason a transfer fails or strands.
- No server, no API keys, no third party script on the site.
- No change to any fund critical field: amounts, recipients, destination
  caller, finality threshold, hook data.

## Constraints found during research

- Stellar contract transactions reject any memo (consensus rule; simulation
  answers "Soroban transactions do not support memos"). A fixed past
  `timebounds.minTime` is accepted and readable afterwards; proven on testnet
  with tx `47672cb0d9ad29f0b1d875f4660c6bd763e93fd2c3deb2523dda5649926545b8`.
- Circle's EVM contracts ignore bytes after the encoded arguments. Simulated
  against the live mainnet TokenMessengerV2 and MessageTransmitterV2: identical
  outcomes with and without 31 trailing bytes, for both burn entry points and
  for `receiveMessage`.
- The Solana mint transaction is already at the 1232 byte limit (creating the
  token account had to be split out for that reason), so it has no room for a
  memo. The burn has room.
- CCTP V2 burns per day on the large chains are in the low thousands
  (sampled: Arbitrum about 7,300, Ethereum about 3,300, OP about 1,100,
  Polygon about 1,200), so reading every burn and checking its input is cheap.

## Approaches considered

1. **On chain tag plus a counting job in this repo (picked).** No server, all
   26 chains, reproducible by anyone. Costs: a permanent public label on user
   transactions and a script to maintain.
2. **A ping to a small server after each burn.** Exact and simple, but it is a
   server and it is tracking, which the product rules out.
3. **A hosted SQL dashboard (Dune).** The free plan no longer runs queries and
   five of the 26 chains are not indexed there.
4. **Tag inside CCTP hook data.** Visible on both legs, but hook data is fund
   critical: it is the forwarder payload on Stellar bound burns, and extra
   bytes can push a Solana bound mint over the size limit.

## Design

### 1. The tag

One module, `src/lib/attribution/`, owns the constants, the on/off rule and
the matching helpers used by both the app and the counting job.

| Family  | Tag                                                                                                                                                     | Applied to                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| EVM     | 28 byte suffix after the call data: ascii `stablehops`, length byte `0x0a`, schema byte `0x00`, 16 byte marker `0x8021…8021` (ERC-8021 schema 0 layout) | `depositForBurn`, `depositForBurnWithHook`, `receiveMessage`. Never the USDC approve. |
| Solana  | SPL Memo v3 instruction (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, immutable) with text `stablehops`, zero accounts                                | burn only                                                                             |
| Stellar | `timebounds.minTime = 1752133747` (`0x686f7073`, ascii `hops`, 2025-07-10)                                                                              | burn, mint, trustline setup                                                           |

**When the tag is on.** Only on listed official hostnames. The list starts
with the testnet site only; the mainnet hostname is added after one real
transfer per family has been checked on the testnet site. Forks, previews and
localhost never tag, except localhost with the dev flag
`localStorage['stellarusdcto.tag'] = 'on'` for manual testing.

**Fail open, per family.**

- EVM: before signing, the same call is simulated with and without the suffix
  from the user's address. The suffix is used only when both outcomes are
  identical (same return data, or the same non empty revert data). Any
  difference or any RPC failure means no suffix. The existing pre signature
  simulation of the plain call stays as the guard against doomed transactions.
- Solana: the memo is added only if the signed wire transaction stays within
  1232 bytes; otherwise the transaction is built without it.
- Stellar contract calls: the tagged transaction is built and simulated
  first. If that fails for any reason, the untagged transaction is simulated
  and used, so errors shown to the user are the same as today. This covers an
  RPC failure and any rule the simulator enforces (it is how a memo is
  refused). Simulation does not evaluate time bounds, so it is not what proves
  the tag is accepted: that was proven by landing tagged transactions on
  testnet, and the owner's check through the wallet repeats it. If the network
  ever refused the tag at submission, the transaction would not land and no
  funds would move, but Stellar transfers would fail until the tag is switched
  off in a deploy.
- Stellar classic (trustline): time bounds are long standing protocol
  behaviour, so the tag is applied without a second path.

**Disclosure.** The three burn previews gain one row that names the tag and
says what it is. Those previews exist only for routes that include Stellar, so
everything else (burns between other chains, mints, the trustline) is covered
by the footer, which on a site that tags gains one sentence next to "no
tracking" and a link to `/stats`, where counting is explained. On a site where
tagging is off the sentence is not shown and `/stats` says so.

### 2. The counting job

`scripts/stats/collect.ts`, run with tsx like the existing scripts, mainnet
registry only, public RPCs only.

- **EVM (24 chains, each isolated):** `eth_getLogs` for `DepositForBurn` on the
  chain's TokenMessengerV2 from the last checkpoint to a quarter of an hour
  behind the head, in ranges that narrow when an RPC refuses them. A node that
  is behind answers a log query with an empty list rather than an error, so
  every endpoint is asked for its own block number in the same request and is
  only believed if it has reached the end of the range. For each log the
  transaction input is fetched (in batches, each endpoint asked only for what
  the ones before it could not return) and searched for the suffix anywhere in
  it, which also covers batched and smart account calls. Each chain has a time
  budget per run; unfinished ranges continue on the next run.
- **Solana:** `getSignaturesForAddress` on the TokenMessengerMinter program,
  newest first, until the checkpoint signature itself is seen. A short page
  only shows that a node has no older history, so it never counts as having
  reached the checkpoint, and one endpoint reads a whole pass. A pass cut
  short by the time budget keeps its place. The response carries each
  transaction's memo, so only transactions whose memo is the tag are fetched
  and decoded.
- **Stellar:** `getEvents` for the CCTP contracts from the checkpoint. Each
  event's transaction envelope is fetched and its `minTime` compared to the tag
  value. Burns feed the transfer ledger; tagged mints feed the mint ledger.
  The RPC keeps about seven days. History older than that which should have
  been read is gone for good, so it is recorded as a hole: kept in the state
  from then on, published with the totals, and shown on the page.
- **Nonces:** each tagged burn is resolved to its CCTP nonce through Circle's
  public Iris API. A tagged Stellar mint whose nonce matches no tagged burn is
  a rescue.
- **First run:** each chain starts at the block or ledger for
  `TAG_SINCE = 2026-11-16`, not at genesis.

State and output live in a data directory:

- `transfers.jsonl`: one line per counted burn (chain, tx, time, sender,
  amount in 6 decimal units, destination, nonce).
- `mints.jsonl`: one line per tagged Stellar mint.
- `checkpoints.json`: per chain progress, last status, and the holes.
- `stats.json`: what the page reads. Totals, daily series, routes, the most
  recent transfers, per chain coverage, and the holes.

A daily GitHub Actions workflow runs the job and commits the data directory to
a separate `stats` branch, so the main branch history stays clean. It uses no
secrets. It is two jobs: the one that installs dependencies and runs the
script has a read only token, and the one that holds the write token runs no
dependency code, only the repo's own script that commits the result.

### 3. The page

The file is treated as untrusted input: it is refused as a whole unless it has
exactly the expected shape and sizes, explorer links are built from the
registry rather than taken from it, and anything that still goes wrong while
drawing falls back to the same card as a failed load.

`/stats` fetches `stats.json` from the `stats` branch at view time
(`raw.githubusercontent.com`, CORS enabled), so numbers refresh without a
redeploy. It shows totals, a daily chart, the route table, recent transfers,
per chain coverage, an "as of" time, and a short explanation of the tag. It
has explicit empty and unavailable states.

## Calls made while designing (not owner decisions)

- No separate "rescue" tag variant: rescues are derived by matching nonces,
  which is exact and keeps the tag to one constant per family.
- EVM mints are tagged now but not scanned yet. Scanning every mint on 24
  chains doubles the job for a small number; the tags are there if wanted.
- The staged hostname list (testnet site first) follows the "testnet first"
  rule the owner approved.
- Unique wallets are distinct signing addresses. One person with wallets on
  two families counts twice.
- The Stellar tag value spells `hops` in ascii so it explains itself.

## Testing

- Unit tests for the tag encoding (against the ERC-8021 spec vector), the
  hostname rule, the EVM gate, the Solana size fallback and real burn sizes,
  the Stellar builder and fallback, tag detection in plain and batched inputs,
  the event and instruction decoders, and aggregation.
- Live read only checks: the EVM gate against mainnet contracts, a tagged
  Solana burn simulated on mainnet without signatures, the collector over a
  short recent window on every chain.
- Owner check before mainnet: one real transfer per family on the testnet
  site, then add the mainnet hostname.

## Known limits

- Anyone can copy the tag, so the numbers mean "transactions carrying the tag".
- Transfers finished into Solana cannot be marked as finished here.
- Rescue counts cover Stellar destinations only until EVM mints are scanned.
- A burn that went out untagged because a pre signing check declined the tag
  is invisible to the count. If it is then finished here on Stellar, that mint
  is tagged and reads as a rescue.
- A tagged transaction whose burn cannot be decoded (a changed event or
  instruction layout) is skipped on Solana and Stellar without an error.
