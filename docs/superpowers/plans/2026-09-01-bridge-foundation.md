# Bridge foundation implementation plan

**Goal:** implement `../specs/2026-09-01-bridge-foundation-design.md`: registry as data, per family adapters, one transfer engine, error translation, transfer journal, tests, CI, experiment harness.

**Spec:** `docs/superpowers/specs/2026-09-01-bridge-foundation-design.md`

**Tech:** Svelte 5 runes, SvelteKit static, viem, @stellar/stellar-sdk, @solana/kit, vitest, tsx.

## Global constraints

- Commit style: Conventional Commits, plain spoken descriptions, short, no dash character, no co author line, no phase or tooling mentions.
- Never mix environments: testnet and mainnet data travel as whole registries.
- The forwarder invariant (Stellar bound burns: mintRecipient = destinationCaller = CctpForwarder, recipient only in hook data) exists in exactly one code path and is unit tested.
- No new runtime dependencies beyond what exists; dev dependencies added: vitest, tsx.
- The app must still work end to end on testnet after every task.

## Tasks

### 1. Test infrastructure

Add `vitest` and `tsx` dev dependencies, `vitest.config.ts` with a `$lib` alias to `src/lib`, scripts `"test": "vitest run"` and `"test:watch": "vitest"`. One trivial passing test proves the harness. Commit: `test: add vitest`.

### 2. Amount handling (`src/lib/amounts.ts`)

Strict USDC parsing, canonical 6 decimal units. Produces:

- `parseUsdc(input: string): bigint` — throws `TransferError(AMOUNT_INVALID | AMOUNT_TOO_MANY_DECIMALS)`; accepts plain decimal strings, max 6 fraction digits, must be > 0.
- `formatUsdc(units6: bigint): string`
- `toStellarSubunits(units6: bigint): bigint` (×10) and `fromStellarSubunits(subunits7: bigint): bigint` (must divide evenly; throws otherwise)
  Tests first: happy paths, 7 decimals rejected, `""`, `"1,5"`, `"1e5"`, `"-1"`, `"0"` rejected, round trips. Commit: `feat: one strict USDC amount parser`.

### 3. Error layer (`src/lib/errors/`)

`codes.ts`: `TransferErrorCode` union, `TransferError extends Error { code, userMessage, action?, raw?, retryable }`.
`translate.ts`: `translateError(raw: unknown, ctx: { family?: 'evm'|'solana'|'stellar'; phase?: string }): TransferError` — classifiers for: user rejection (viem `UserRejectedRequestError`, Freighter decline strings, wallet reject phrases), Soroban `Error(Contract, #9)` → allowance, `Account not found` → account missing, `Nonce already used` → already minted, HTTP 429 → rate limited, `fetch failed`/`TypeError` → RPC unreachable, fallback UNKNOWN keeps the raw text behind details. Message catalog maps every code to a plain sentence plus a next step. Tests: one representative raw error per classifier. Commit: `feat: translate raw chain errors into plain language`.

### 4. Registry (`src/lib/registry/`)

`types.ts`, `testnet.ts` (current Arc, Base, Ethereum testnets + Solana devnet + Stellar testnet moved from `config.ts`), `mainnet.ts` (verified values only: EVM pair `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` / `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`, Ethereum + Base mainnet entries, Solana mainnet with mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` and RPC `https://solana-rpc.publicnode.com`, Stellar mainnet contracts + USDC SAC/issuer, RPC fallback list led by `https://mainnet.sorobanrpc.com`; no Arc mainnet until Circle publishes parameters), `index.ts` with `getRegistry()`, `getChain(id)`, `stellarConfig()`, `irisBase()` (env fixed to testnet for now behind one seam). Delete `config.ts`; update every import. Registry tests: ids and domains unique, Stellar domain 27, address shapes valid, no BNB anywhere, mainnet contains no Arc, testnet Iris host is the sandbox. Commit: `feat: put every chain in one registry`.

### 5. Journal (`src/lib/journal/journal.ts`)

`TransferRecord { id, env, sourceId, destId, amount6, recipient, speed, flow, phase, burnTxId?, nonce?, mintTxId?, error?, createdAt, updatedAt }` under key `stellarusdcto.journal.v1`, all reads and writes wrapped in try/catch. API: `saveTransfer`, `updateTransfer`, `listTransfers`, `unfinishedTransfers`, `removeTransfer`, `clearJournal`. Tests with a stubbed `localStorage`. Commit: `feat: remember transfers in the browser so refresh is safe`.

### 6. Adapters (`src/lib/adapters/`)

Interface per the spec. Implementations wrap the existing `stellar/`, `evm/`, `solana/` modules; burn functions generalized to take `(destinationDomain, mintTarget, amount, maxFee, finality)`; new small on chain reads: `is_nonce_used` (Stellar), `usedNonces` (EVM), `used_nonce` PDA probe (Solana). Stellar `checkDestination` does the one Horizon call (exists, trustline, capacity, authorized; M address decodes to the underlying G first). Invariant tests assert exact bytes from `mintTarget` for all three families, including the full hook data layout. Commit: `feat: one adapter per chain family`.

### 7. Engine (`src/lib/engine/`)

`core.ts` pure helpers: `classifyHash(hash)`, `candidateDomains(hash, registry)`, `buildSteps(source, dest, flow)`. `transfer.svelte.ts` replaces the six runners in `stores/transfer.svelte.ts` with one sequence: preflight → approve if needed → burn → attest → nonce check → mint, journaling at every transition, `translateError` on every failure. `resume(hash)` needs only the hash: probe candidate domains via Iris, derive the route from the response, check the nonce, run the tail with only the wallet the mint needs. Flows: `direct`, `sendCalls`, `forwarded` (flag, default off). Wrapper flows are not ported. Core helper tests. Commit: `feat: one transfer engine for every route`.

### 8. UI rewire and cleanup

`+page.svelte` and panels read the registry; flow chips reduce to direct + sendCalls (EVM) and direct (+ forwarded flag) on Stellar; `ResumeForm` becomes hash only; delete `src/routes/forward-test/`, the EVM wrapper client code, the Soroban wrapper client code and their preview branches. `contracts/` stays untouched. Commits: `refactor: drive the app from the registry`, `feat: resume a transfer from just its hash`, `chore: drop the wrapper flows and the test route`.

### 9. CI (`.github/workflows/`)

`ci.yml`: frozen install, lint, check, test, build. `registry-check.yml`: weekly cron + manual, runs `tsx scripts/check-circle-docs.ts` which fetches Circle's `supported-chains-and-domains.md` and `contract-addresses.md` twins, extracts domains and the uniform address pairs, and exits nonzero when they drift from the registry. Commit: `ci: run checks and watch circle chain data`.

### 10. Experiment harness (`scripts/experiments/`, `docs/experiments/`)

Status doc `docs/experiments/2026-09-01-safety-experiments.md`. Scripts: `nonce-used.ts` (read only: burn hash → Iris nonce → on chain used check per family) and `iris-probe.ts` (read only: hash → candidate domains → route + status) run now with results recorded; `trustline-missing.ts`, `seventh-decimal.ts`, `muxed-recipient.ts` scripted end to end but requiring funded test wallets, marked waiting. Commit: `test: add the safety experiment scripts`.

### 11. Verification

`pnpm lint && pnpm run check && pnpm test && pnpm run build`, dev server smoke, README pruned of flows that no longer exist (`docs: update the readme for the new flows`).
