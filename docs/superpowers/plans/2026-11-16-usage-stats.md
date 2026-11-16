# Usage Stats Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every transaction the app sends with a public `stablehops` marker, count the tagged transfers from public RPCs with a script in this repo, and show the totals on `/stats`.

**Architecture:** One module (`src/lib/attribution/tag.ts`) owns the tag constants, the on/off rule and the matching helpers; the three chain families apply the tag through a small fail open wrapper each. A tsx script (`scripts/stats/`) scans the mainnet registry chains, appends to a JSONL ledger and writes `stats.json`; a daily workflow commits that data to a `stats` branch; the page fetches it at view time.

**Tech Stack:** Svelte 5 + SvelteKit static, viem 2.55, @solana/kit 7, @stellar/stellar-sdk 16, vitest 4, tsx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-usage-stats-design.md`

## Global Constraints

- Tag text is exactly `stablehops`. EVM suffix is the ERC-8021 schema 0 layout: ascii codes, one length byte, `0x00`, then `0x80218021802180218021802180218021` (28 bytes for this tag).
- Solana memo program is SPL Memo v3 `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, zero accounts, burn only.
- Stellar tag is `timebounds.minTime = 1752133747` on burn, mint and trustline setup. Never a memo.
- The tag is never applied to the USDC approve and never changes amounts, recipients, destination caller, finality threshold or hook data.
- Tagged hostnames list is `['stellarusdcto-testnet.vercel.app']` only. Localhost tags only with `localStorage['stellarusdcto.tag'] === 'on'`.
- Fail open everywhere: if the tag cannot be proven harmless before signing, the untagged transaction is sent and behaves exactly as today.
- The counting job uses public RPCs only: no secrets, no API keys, mainnet registry only, first run starts at `TAG_SINCE = 2026-11-16T00:00:00Z`.
- No new npm dependencies.
- Commits: Conventional Commits, plain spoken, no dash character anywhere in the message, no co author line, local only, never push.
- Code comments, commit messages and docs never mention tooling used to write them.
- Dark mode only; reuse the existing tokens in `src/app.css` and the `glass` surfaces.
- Svelte 5: read reactive dependencies before the first `await` in any async derived.
- Users never see raw errors; the stats page shows plain language states.

## Review Focus

1. A wallet batches the burn (EIP-7702 or a smart account), so the suffix sits in the middle of the transaction input: the counting job must still find it. Test in Task 6 (`inputHasTag` on an embedded suffix).
2. An RPC strips revert data, so tagged and untagged simulations both say only "execution reverted": that proves nothing and the transfer must go out untagged. Test in Task 2.
3. Building the tagged and the untagged Stellar transaction from one `Account` object would consume two sequence numbers and make the fallback transaction invalid. Test in Task 4 (both builds carry the same sequence).
4. The counting job reruns over a range it already scanned (a crash, a manual run): totals must not double. Test in Task 5 (append is idempotent by id).
5. One chain's RPC fails mid run: its checkpoint must not move past unscanned blocks and other chains must still be saved. Test in Task 6 (range runner stops at the last completed range).
6. `stats.json` is missing, unreachable or an unknown schema: the page shows the unavailable state, never a broken page. Test in Task 9 (`parseStats`).

---

## File Structure

| File                                                                   | Responsibility                                                                                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/attribution/tag.ts` (new)                                     | Constants, suffix encoder, host rule, `inputHasTag`, `memoHasTag`, `minTimeIsTag`. No `$lib` or `$app` imports so scripts can import it. |
| `src/lib/evm/tag.ts` (new)                                             | `evmTagSuffix`: the simulate both ways gate.                                                                                             |
| `src/lib/evm/cctp.ts` (modify)                                         | Three send paths ask the gate and pass the suffix.                                                                                       |
| `src/lib/solana/tag.ts` (new)                                          | `tagMemoInstruction`.                                                                                                                    |
| `src/lib/solana/signer.ts` (modify)                                    | `encodeForSigning` with optional instructions and the 1232 byte fallback.                                                                |
| `src/lib/solana/cctp.ts` (modify)                                      | `buildBurnInstruction` extracted; burn passes the memo as optional.                                                                      |
| `src/lib/stellar/tx.ts` (modify)                                       | `stellarTimebounds`, `pickTaggedOrPlain`, `simulateSignAndSubmitTagged`.                                                                 |
| `src/lib/stellar/cctp.ts`, `src/lib/stellar/usdc.ts` (modify)          | Burn, mint and trustline use the tagged path.                                                                                            |
| `src/lib/components/ui/TagNote.svelte` (new) + three previews (modify) | One disclosure row.                                                                                                                      |
| `src/routes/+layout.svelte` (modify)                                   | Footer sentence, Stats nav link.                                                                                                         |
| `src/lib/stats/types.ts`, `format.ts`, `source.ts` (new)               | Shape of `stats.json`, parsing and formatting, the fetch URL.                                                                            |
| `scripts/stats/*.ts` (new)                                             | `store`, `aggregate`, `evm`, `solana`, `stellar`, `iris`, `collect`.                                                                     |
| `tests/stats/*.test.ts` (new)                                          | Collector unit tests (already inside the vitest include).                                                                                |
| `.github/workflows/usage-stats.yml` (new)                              | Daily run, commit to the `stats` branch.                                                                                                 |
| `src/routes/stats/+page.svelte` (new)                                  | The page.                                                                                                                                |
| `README.md` (modify)                                                   | How usage is counted and how to rerun it.                                                                                                |

---

### Task 1: Tag constants and matching helpers

**Files:**

- Create: `src/lib/attribution/tag.ts`
- Test: `src/lib/attribution/tag.test.ts`

**Interfaces:**

- Produces:
  - `TAG = 'stablehops'`, `EVM_TAG_SUFFIX: Hex`, `SOLANA_MEMO_PROGRAM: string`, `STELLAR_TAG_MIN_TIME = 1752133747`, `TAGGED_HOSTS: readonly string[]`, `TAG_DEV_FLAG_KEY = 'stellarusdcto.tag'`
  - `encodeEvmSuffix(codes: string[]): Hex`
  - `isTagHost(hostname: string | undefined, devFlag: string | null): boolean`
  - `tagEnabled(): boolean` (reads `location.hostname` and `localStorage`, both guarded)
  - `inputHasTag(input: string, suffix?: string): boolean` (case insensitive, anywhere in the input)
  - `memoHasTag(memo: string | null | undefined): boolean`
  - `minTimeIsTag(minTime: string | number | bigint | null | undefined): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
test('encodes the ERC-8021 schema 0 spec vector', () => {
  expect(encodeEvmSuffix(['baseapp'])).toBe('0x62617365617070070080218021802180218021802180218021');
});
test('the stablehops suffix is 28 bytes and ends with the marker', () => {
  expect(EVM_TAG_SUFFIX).toBe('0x737461626c65686f70730a0080218021802180218021802180218021');
});
test('rejects codes that are not 7 bit ascii or contain a comma', () => {
  expect(() => encodeEvmSuffix(['a,b'])).toThrow();
  expect(() => encodeEvmSuffix(['né'])).toThrow();
});
test('only listed hosts tag, localhost needs the dev flag', () => {
  expect(isTagHost('stellarusdcto-testnet.vercel.app', null)).toBe(true);
  expect(isTagHost('STELLARUSDCTO-TESTNET.vercel.app', null)).toBe(true);
  expect(isTagHost('stellarusdcto.vercel.app', null)).toBe(false);
  expect(isTagHost('stellarusdcto-git-x.vercel.app', 'on')).toBe(false);
  expect(isTagHost('localhost', null)).toBe(false);
  expect(isTagHost('localhost', 'on')).toBe(true);
  expect(isTagHost(undefined, 'on')).toBe(false);
});
test('finds the suffix at the tail, embedded in a batch, and in any case', () => {
  const s = EVM_TAG_SUFFIX.slice(2);
  expect(inputHasTag('0xdeadbeef' + s)).toBe(true);
  expect(inputHasTag('0xdeadbeef' + s + '00'.repeat(40))).toBe(true);
  expect(inputHasTag('0xDEADBEEF' + s.toUpperCase())).toBe(true);
  expect(inputHasTag('0xdeadbeef')).toBe(false);
});
test('memo and min time matching', () => {
  expect(memoHasTag('[10] stablehops')).toBe(true);
  expect(memoHasTag('[5] hello; [10] stablehops')).toBe(true);
  expect(memoHasTag(null)).toBe(false);
  expect(minTimeIsTag('1752133747')).toBe(true);
  expect(minTimeIsTag(1752133747n)).toBe(true);
  expect(minTimeIsTag('0')).toBe(false);
  expect(minTimeIsTag(undefined)).toBe(false);
});
```

- [ ] **Step 2: Run** `pnpm test -- src/lib/attribution` and see them fail (module missing).
- [ ] **Step 3: Implement `tag.ts`.** `encodeEvmSuffix` joins codes with `,`, requires 1 to 255 bytes of 7 bit ascii, emits `codes || length byte || 00 || marker`. `EVM_TAG_SUFFIX = encodeEvmSuffix([TAG])`.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit** `feat: add the stablehops tag encoding and host rule`

### Task 2: EVM gate and the three send paths

**Files:**

- Create: `src/lib/evm/tag.ts`, `src/lib/evm/tag.test.ts`
- Modify: `src/lib/evm/cctp.ts` (`evmBurnToTarget`, `evmSendCallsBurnToTarget`, `receiveMessageOnEvm`)
- Test: `src/lib/evm/cctpTag.test.ts`

**Interfaces:**

- Consumes: `EVM_TAG_SUFFIX`, `tagEnabled` from Task 1.
- Produces: `evmTagSuffix(args: { client: { call: PublicClient['call'] }; account: Address; to: Address; data: Hex; enabled?: boolean }): Promise<Hex | undefined>`

- [ ] **Step 1: Write the failing gate tests** with a fake `client.call`:
  - both calls return the same data → resolves `EVM_TAG_SUFFIX`
  - both revert with the same non empty revert data → `EVM_TAG_SUFFIX`
  - tagged reverts, plain succeeds → `undefined`
  - both revert but the errors carry no revert data → `undefined`
  - the call rejects with a transport error → `undefined`
  - `enabled: false` → `undefined` and `call` is never invoked
  - the tagged call receives `data` ending in the suffix, the plain call receives `data` unchanged
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement `evmTagSuffix`.** Run both `client.call({ account, to, data })` in parallel; reduce each to `ok:<returndata>`, `revert:<data>` or `null` (walk the viem error for a `data` hex string; anything without one is `null`); return the suffix only when both are non null and equal.
- [ ] **Step 4: Write the failing wiring tests** in `cctpTag.test.ts` (mock `./client` and `./tag` with `vi.mock`, fake `walletClient`):
  - `evmSendCallsBurnToTarget`: `calls[0].data` is the plain approve, `calls[1].data` ends with the suffix when the gate returns it and equals the plain burn data when it returns `undefined`
  - `evmBurnToTarget` and `receiveMessageOnEvm`: `writeContract` receives `dataSuffix` equal to the gate result, and `simulateContract` is still called without a suffix first
- [ ] **Step 5: Wire the three paths.** Encode the call data once with `encodeFunctionData`, ask the gate with `to` set to the contract being called, pass `dataSuffix` to `writeContract` or append with `concat` for `sendCalls`.
- [ ] **Step 6: Run** `pnpm test -- src/lib/evm` and see all pass.
- [ ] **Step 7: Commit** `feat: tag evm burns and mints when a simulation proves it harmless`

### Task 3: Solana memo with size fallback

**Files:**

- Create: `src/lib/solana/tag.ts`, `src/lib/solana/tag.test.ts`
- Modify: `src/lib/solana/signer.ts`, `src/lib/solana/cctp.ts`

**Interfaces:**

- Consumes: `TAG`, `SOLANA_MEMO_PROGRAM`, `tagEnabled`.
- Produces:
  - `tagMemoInstruction(): Instruction`
  - `SOLANA_MAX_TX_BYTES = 1232`
  - `encodeForSigning(args: { instructions: Instruction[]; optionalInstructions?: Instruction[]; feePayerSigner: TransactionSigner; blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint } }): Promise<{ wire: Uint8Array; includedOptional: boolean }>`
  - `buildBurnInstruction(args: { owner: Address; amount: bigint; destinationDomain: number; target: MintTarget; maxFee: bigint; minFinalityThreshold: number }): Promise<Instruction>` (the instruction building lifted out of `solanaBurnToTarget`, no RPC)
  - `signAndSendSolanaTx` gains `optionalInstructions?: Instruction[]`

- [ ] **Step 1: Write the failing tests**
  - the memo instruction targets the memo program, has no accounts, and its data is the utf8 bytes of `stablehops`
  - a real burn toward Stellar (hook data from `encodeStellarForwarderHookData`) plus the memo encodes with `includedOptional === true` and `wire.length <= 1232`; log the byte count
  - a plain burn (no hook) plus the memo: same
  - an optional instruction with 1300 bytes of data: `includedOptional === false` and the wire equals the encoding without it
  - no optional instructions: `includedOptional === false`
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** `encodeForSigning` compiles and partially signs with the optional instructions; if that throws or exceeds the limit it compiles again without them. `signAndSendSolanaTx` fetches the blockhash and delegates to it.
- [ ] **Step 4: Pass the memo from `solanaBurnToTarget`** only when `tagEnabled()`. `receiveMessageOnSolana` is untouched.
- [ ] **Step 5: Run** `pnpm test -- src/lib/solana` and see all pass.
- [ ] **Step 6: Commit** `feat: tag solana burns with a memo when it fits`

### Task 4: Stellar valid after marker

**Files:**

- Modify: `src/lib/stellar/tx.ts`, `src/lib/stellar/cctp.ts`, `src/lib/stellar/usdc.ts`
- Test: `src/lib/stellar/tx.test.ts` (new)

**Interfaces:**

- Consumes: `STELLAR_TAG_MIN_TIME`, `tagEnabled`.
- Produces:
  - `STELLAR_TX_TIMEOUT_S = 180`
  - `stellarTimebounds(minTime: number, nowMs?: number): { minTime: number; maxTime: number }`
  - `pickTaggedOrPlain<T, S>(args: { build: (minTime: number) => T; simulate: (tx: T) => Promise<S>; failed: (sim: S) => boolean; enabled: boolean }): Promise<{ tx: T; sim: S; tagged: boolean }>`
  - `simulateSignAndSubmitTagged(build: (minTime: number) => Transaction): Promise<string>`

- [ ] **Step 1: Write the failing tests**
  - `stellarTimebounds(0, 1_000_000)` is `{ minTime: 0, maxTime: 1180 }`
  - enabled, tagged simulation ok → returns the tagged build, `simulate` called once
  - enabled, tagged simulation fails → returns the plain build and the plain simulation result, `tagged === false`
  - enabled, both fail → returns the plain result (the caller reports the plain error, as today)
  - disabled → `build` called once with `0`, `simulate` once
  - with a real `TransactionBuilder` builder: the tagged and the plain build have the same sequence number and the tagged one has `timeBounds.minTime === '1752133747'`
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** Builders passed in by callers create a fresh `Account(caller, sequence)` on every call so nothing is consumed twice.
- [ ] **Step 4: Switch `stellarDepositForBurn` and `mintAndForward`** to `simulateSignAndSubmitTagged`, and `addUsdcTrustline` to `timebounds: stellarTimebounds(tagEnabled() ? STELLAR_TAG_MIN_TIME : 0)`. `approveUsdc` is untouched.
- [ ] **Step 5: Run** `pnpm test -- src/lib/stellar` and see all pass.
- [ ] **Step 6: Commit** `feat: tag stellar transactions with a valid after marker`

### Task 5: Stats shapes, ledger store and aggregation

**Files:**

- Create: `src/lib/stats/types.ts`, `scripts/stats/store.ts`, `scripts/stats/aggregate.ts`
- Test: `tests/stats/aggregate.test.ts`, `tests/stats/store.test.ts`

**Interfaces:**

- Produces (`src/lib/stats/types.ts`):

```ts
export const STATS_SCHEMA = 1;
export type TransferRecord = {
  id: string;
  chain: string;
  tx: string;
  time: string;
  from: string;
  amount: string;
  destDomain: number;
  dest: string | null;
  nonce: string | null;
};
export type MintRecord = {
  id: string;
  chain: 'stellar';
  tx: string;
  time: string;
  sourceDomain: number;
  source: string | null;
  amount: string;
  nonce: string;
};
export type ChainCoverage = {
  chain: string;
  status: 'ok' | 'behind' | 'error';
  through: string | null;
  note?: string;
};
export type Stats = {
  schema: 1;
  generatedAt: string;
  since: string;
  tag: string;
  totals: {
    transfers: number;
    volume: string;
    wallets: number;
    walletsByFamily: { evm: number; solana: number; stellar: number };
    rescues: number;
    rescuedVolume: string;
  };
  daily: { date: string; transfers: number; volume: string; newWallets: number }[];
  routes: { source: string; dest: string; transfers: number; volume: string }[];
  recent: { time: string; source: string; dest: string; amount: string; tx: string; url: string }[];
  coverage: ChainCoverage[];
};
```

- Produces (`scripts/stats/store.ts`): `readJsonl<T>(path): T[]`, `appendUnique<T extends { id: string }>(existing: T[], incoming: T[]): T[]`, `writeJsonl`, `readJson`, `writeJson`.
- Produces (`scripts/stats/aggregate.ts`): `buildStats(args: { transfers: TransferRecord[]; mints: MintRecord[]; coverage: ChainCoverage[]; familyOf: (chain: string) => 'evm' | 'solana' | 'stellar'; explorerUrl: (chain: string, tx: string) => string; now: Date; since: string }): Stats`

Amounts are 6 decimal integer strings throughout.

- [ ] **Step 1: Write the failing tests**
  - `appendUnique` keeps one record per id and preserves order
  - totals: three transfers of `1000000`, `2500000`, `500000` → `transfers 3`, `volume '4000000'`
  - wallets: the same EVM address in different letter case on two chains counts once; a Stellar and a Solana address add one each
  - daily: records on two UTC dates produce two rows in date order; a wallet seen on day one is not new on day two
  - routes: grouped by `chain → dest`, sorted by volume descending; an unknown destination domain is labelled `domain <n>`
  - rescues: a mint whose `sourceDomain:nonce` matches no transfer nonce counts, one that matches does not
  - recent: at most 20, newest first
- [ ] **Step 2: Run** `pnpm test -- tests/stats` and see them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** `feat: add the usage stats ledger and totals`

### Task 6: EVM scanner

**Files:**

- Create: `scripts/stats/evm.ts`
- Test: `tests/stats/evm.test.ts`

**Interfaces:**

- Consumes: `inputHasTag`, `TransferRecord`.
- Produces:
  - `DEPOSIT_FOR_BURN_TOPIC = '0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5'`
  - `decodeBurnLog(log): { depositor: Address; amount: bigint; destDomain: number }`
  - `runRanges(args: { from: bigint; to: bigint; initialSpan: bigint; deadline: number; now: () => number; scan: (from: bigint, to: bigint) => Promise<void> }): Promise<{ through: bigint; complete: boolean; error?: string }>` (halves the span on a range error, grows it back after successes, stops at the deadline or after repeated failures at span 1)
  - `scanEvmChain(args: { entry: EvmChainEntry; rpcUrls: string[]; fromBlock: bigint | null; since: Date; deadline: number; suffix?: string }): Promise<{ records: TransferRecord[]; through: bigint; throughTime: string | null; coverage: ChainCoverage }>`

- [ ] **Step 1: Write the failing tests**
  - `decodeBurnLog` on a real mainnet log captured as a fixture returns the depositor, amount and destination domain shown on the explorer
  - `runRanges`: a scan that always succeeds covers `from..to` and reports `complete: true`
  - a scan that throws "block range too large" above 100 blocks ends up succeeding with spans of at most 100
  - a scan that throws at the third range returns `through` equal to the end of the second range and `complete: false`
  - the deadline passing stops the run with `complete: false` and no error
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** viem public client over a `fallback` of the given URLs; first run finds the first block at or after `since` by binary search; each range does `getLogs` then fetches each distinct transaction once with a small concurrency limit and keeps logs whose transaction input passes `inputHasTag`.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Live check (read only):** scan the last few hundred blocks of every mainnet EVM chain with the default suffix and print per chain status; then scan a known tagged burn's block on Base with that burn's own suffix to prove detection on real data. Record which chains need RPC overrides.
- [ ] **Step 6: Commit** `feat: scan evm chains for tagged burns`

### Task 7: Solana and Stellar scanners, nonces

**Files:**

- Create: `scripts/stats/solana.ts`, `scripts/stats/stellar.ts`, `scripts/stats/iris.ts`
- Test: `tests/stats/solana.test.ts`, `tests/stats/stellar.test.ts`

**Interfaces:**

- Produces:
  - `decodeSolanaBurn(tx): { owner: string; amount: bigint; destDomain: number } | null` (finds the `deposit_for_burn` or `deposit_for_burn_with_hook` instruction by discriminator)
  - `scanSolana(args: { entry: SolanaChainEntry; untilSignature: string | null; since: Date; deadline: number }): Promise<{ records: TransferRecord[]; newest: string | null; coverage: ChainCoverage }>`
  - `parseBurnEvent(event): { depositor: string; amount: bigint; destDomain: number } | null`
  - `parseMintEvent(event): { nonce: string; sourceDomain: number; amount: bigint } | null` (from `message_received`)
  - `envelopeMinTime(envelopeXdr: string): string | null`
  - `scanStellar(args: { config: StellarConfig; rpcUrls: string[]; fromLedger: number | null; since: Date; deadline: number }): Promise<{ transfers: TransferRecord[]; mints: MintRecord[]; through: number; coverage: ChainCoverage }>`
  - `resolveNonces(records: TransferRecord[], irisBase: string, domainOf: (chain: string) => number): Promise<TransferRecord[]>` (fills `nonce` where it is null, leaves it null when Iris has no answer yet)

- [ ] **Step 1: Write the failing tests** against fixtures captured from mainnet (events) and from the testnet proof transaction (envelope):
  - `parseBurnEvent` on a real `deposit_for_burn` event returns depositor `GBRFS5SMB55JJHJIHZQEZYBHDPBEM3WGMDUR7WQ6YBVYTOYJXXHAGIJ7`, amount `50070000n`, destination domain `6`
  - `parseMintEvent` on a real `message_received` event returns its nonce topic and the amount from the message body
  - `envelopeMinTime` on the envelope of testnet tx `47672cb0…545b8` returns `'1234567890'`, and `null` for an envelope without time bounds
  - `decodeSolanaBurn` on a fixture transaction returns owner, amount and destination domain; a transaction without the instruction returns `null`
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the parsers, then the scanners (Solana pages `getSignaturesForAddress` on the TokenMessengerMinter program and fetches only memo matches; Stellar pages `getEvents` for the three CCTP contracts and fetches each distinct transaction once).
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Live check (read only):** run both scanners over a short recent window and print counts scanned and counts tagged.
- [ ] **Step 6: Commit** `feat: scan solana and stellar for tagged transfers`

### Task 8: Collector entry and the daily workflow

**Files:**

- Create: `scripts/stats/collect.ts`, `.github/workflows/usage-stats.yml`
- Modify: `package.json` (script `stats`), `.gitignore` (local data dir)

**Interfaces:**

- Consumes: everything from Tasks 5 to 7.
- Produces: CLI `pnpm exec tsx scripts/stats/collect.ts --data <dir> [--only base,solana] [--budget-ms 240000]`. Writes `transfers.jsonl`, `mints.jsonl`, `checkpoints.json`, `stats.json`, `README.md` into `<dir>`. Exit code 0 even when single chains fail (their coverage row says so); non zero only when nothing could be written.

- [ ] **Step 1: Implement `collect.ts`:** load state, run every chain in parallel under the budget, append unique, resolve nonces, save checkpoints after each chain, build stats, write files.
- [ ] **Step 2: Run it locally** into a scratch directory and confirm the files appear, a second run adds nothing, and `stats.json` passes `parseStats` from Task 9.
- [ ] **Step 3: Write the workflow:** daily cron plus manual dispatch, `permissions: contents: write`, checkout main, install, fetch or create the orphan `stats` branch as a worktree in `stats-data`, run the collector with `--data stats-data`, commit with message `chore: refresh usage stats` and push that branch only when files changed.
- [ ] **Step 4: Prove the branch handling** against a throwaway local bare repository (first run creates the branch, second run with no changes makes no commit).
- [ ] **Step 5: Commit** `feat: add the usage stats collector` and `ci: refresh usage stats every day`

### Task 9: The stats page

**Files:**

- Create: `src/lib/stats/format.ts`, `src/lib/stats/source.ts`, `src/routes/stats/+page.svelte`
- Test: `src/lib/stats/format.test.ts`

**Interfaces:**

- Consumes: `Stats` from Task 5.
- Produces:
  - `STATS_URL = 'https://raw.githubusercontent.com/y4hyya/stellarusdcto/stats/stats.json'` (overridable by `VITE_STATS_URL` at build time for local preview)
  - `parseStats(raw: unknown): Stats | null` (null for anything that is not schema 1 with the expected shape)
  - `formatUsdc6(amount: string, opts?: { compact?: boolean }): string`
  - `chainLabel(id: string, labels: Record<string, string>): string`

- [ ] **Step 1: Write the failing tests**
  - `parseStats` accepts a valid object, returns null for `null`, a string, schema 2, and an object missing `totals`
  - `formatUsdc6('1234567890')` is `'1,234.57'`; `formatUsdc6('0')` is `'0'`; compact `'1234567890000'` is `'1.23M'`
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the helpers, then the page: loading, unavailable and empty states; four totals; a daily chart as inline SVG; route table; recent transfers with explorer links; per chain coverage; "as of" time; the explanation of the tag.
- [ ] **Step 4: Run** `pnpm test`, `pnpm run check`, `pnpm run lint`.
- [ ] **Step 5: Look at it** in the browser with a sample `stats.json` served locally: all states, narrow and wide.
- [ ] **Step 6: Commit** `feat: add the stats page`

### Task 10: Disclosure

**Files:**

- Create: `src/lib/components/ui/TagNote.svelte`
- Modify: `src/lib/components/EvmBurnPreview.svelte`, `SolanaBurnPreview.svelte`, `StellarBurnPreview.svelte`, `src/routes/+layout.svelte`, `README.md`

- [ ] **Step 1: Add `TagNote`,** one row rendered only when `tagEnabled()`: names the tag for that family (28 bytes after the arguments, a memo, a valid after time) and says the contract ignores it and that it exists so usage can be counted, with a link to `/stats`.
- [ ] **Step 2: Mount it** at the end of the argument list in the three previews.
- [ ] **Step 3: Footer and nav:** add a Stats link to the nav and to the footer links, and the sentence "Transfers carry a public tag so usage can be counted. Nothing is collected." after the existing footer line.
- [ ] **Step 4: README:** a short "How usage is counted" section with the three tags, the rerun command, and the known limits from the spec.
- [ ] **Step 5: Run** `pnpm test`, `pnpm run check`, `pnpm run lint`, `pnpm run build`; look at the previews and footer in the browser.
- [ ] **Step 6: Commit** `feat: show the usage tag in previews and the footer`
