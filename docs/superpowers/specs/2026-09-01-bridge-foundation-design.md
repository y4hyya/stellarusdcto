# Bridge foundation design

**Goal:** turn the demo's hardcoded three testnet routes into the foundation for a production bridge: every chain described by data, one transfer engine over per family adapters, every error translated to plain language, every transfer persisted so a refresh is a non event, and the safety invariants owned in exactly one tested place.

This document locks the architecture. The task breakdown lives in `../plans/2026-09-01-bridge-foundation.md`.

## Verified facts this design stands on

- CCTP V2 has 29 USDC domains: 24 EVM chains (uniform per environment addresses, except EDGE mainnet), Solana, Aptos, Starknet, Stellar. BNB is USYC only. Noble and Sui are V1 legacy. Testnet and mainnet EVM contract addresses differ; the demo only carries testnet ones.
- Circle's relayer never delivers to Stellar (forwarding is destination gated and Stellar is unsupported). Every inbound transfer requires someone to submit `mint_and_forward`, which is atomic and permissionless: any funded account can complete any inbound transfer. Recovery is therefore the core transfer path, not a feature.
- The only irreversible mistakes happen at burn time. For Stellar bound burns, `mintRecipient` and `destinationCaller` must both be Circle's CctpForwarder, with the real recipient riding only in hook data (24 zero bytes, u32 version 0, u32 length, strkey UTF‑8). Anything else permanently strands the funds. For all other burns `destinationCaller` stays zero so anyone can complete the mint.
- Iris `status: complete` means attested, not minted. Real completion is an on chain read: `usedNonces(bytes32)` on EVM, `is_nonce_used` on Stellar, the `used_nonce` PDA on Solana. Standard attestations carry `expirationBlock 0` (no expiry); fast attestations expire in about 24h and are revived free via `POST /v2/reattest/{nonce}`.
- Iris is CORS open and keyless on sandbox and production, rate limited at 40 req/s with a five minute full block on excess. When Stellar is involved, every decoded address field comes back null; domains and the raw hex message are still present, so a local message parser is eventually required (rescue milestone).
- USDC has 7 decimals on Stellar and the wire amount is always 6. Inputs must be quantized so the 7 decimal subunit value is a multiple of 10; Stellar side `max_fee` values need the ×10 conversion.
- Stellar destination preflight is one Horizon call: account existence, USDC trustline, capacity (`limit − balance − buying_liabilities ≥ amount`) and `is_authorized` (Circle's USDC is `auth_revocable`, so trustlines can be frozen).

## Shape of the code

```
src/lib/
  amounts.ts            strict USDC amount parsing, 6 decimal canonical units
  registry/
    types.ts            ChainEntry, StellarConfig, Registry types
    testnet.ts          testnet data (active)
    mainnet.ts          mainnet data (verified values, not yet surfaced in the UI)
    index.ts            active registry accessors
  errors/
    codes.ts            TransferErrorCode, TransferError
    translate.ts        raw error → { code, plain message, next step, retryable }
  journal/
    journal.ts          localStorage transfer records, versioned schema
  adapters/
    types.ts            ChainAdapter interface, MintTarget, BurnParams
    evm.ts  solana.ts  stellar.ts  index.ts
  engine/
    core.ts             pure helpers: step building, hash classification, domain candidates
    transfer.svelte.ts  the one transfer store (replaces stores/transfer.svelte.ts)
```

Existing low level modules (`stellar/`, `evm/`, `solana/`, `circle/`) stay and are wrapped by adapters. `config.ts` dissolves into the registry.

## The registry

Data only, per environment, swapped wholesale — mixing environments is structurally impossible (the Iris host, contract addresses, USDC ids and chain list all travel together). A chain entry:

```ts
type EvmChainEntry = {
  id: string;
  label: string;
  family: 'evm';
  domain: number;
  chain: Chain; // viem chain object
  usdc: `0x${string}`;
  usdcDecimals: 6;
  tokenMessenger: `0x${string}`; // per chain slot, defaulted from the env pair
  messageTransmitter: `0x${string}`; // (EDGE mainnet is the known override)
  attestationEtaMs?: number;
  fastSource: boolean;
  gasNote: string;
};
```

Solana and Stellar have their own entry shapes (cluster string, program ids, mint; passphrase, RPC list, Horizon URL, contract ids, issuer). Adding a chain is a data edit plus a smoke test. A CI job diffs Circle's machine readable docs pages against the registry so new domains and address changes surface automatically.

## Adapters

One `ChainAdapter` per family. The interface owns the dangerous parts:

```ts
interface ChainAdapter {
  entry: ChainEntry;
  validateRecipient(address: string): boolean;
  mintTarget(recipient: string): Promise<MintTarget>; // { mintRecipient32, destinationCaller32, hookData }
  isNonceUsed(nonceHex: string): Promise<boolean | null>;
  checkDestination(recipient: string, amount6: bigint): Promise<TransferError[]>;
  approveIfNeeded(wallet, amount: bigint): Promise<'approved' | 'not_needed'>;
  burn(wallet, params: BurnParams): Promise<string>; // burn tx id
  submitMint(wallet, messageHex: string, attestationHex: string): Promise<string>;
  translate(raw: unknown, phase: Phase): TransferError | null;
}
```

`mintTarget` is the single place the forwarder invariant exists, with unit tests asserting the exact bytes for every family: Stellar destination → forwarder, forwarder, hook data strkey; EVM destination → left padded address, zero caller; Solana destination → token account, zero caller.

## The engine

One sequence replaces the six hand written runners: preflight (hard gate) → approve if needed → burn → attest → nonce check → mint. Parameterized by `(sourceId, destId, flow)` where exactly one side is Stellar. Flows are `direct` (default), `sendCalls` (EVM source, wallet native bundling, no extra contract), `forwarded` (Stellar source auto delivery, opt in, kept behind a flag until verified on mainnet). The wrapper contract flows from the demo are removed: they are unaudited contracts that momentarily control user funds, and this product is a pure interface over Circle's contracts.

Resume becomes hash first: classify the hash shape (base58 → Solana, 0x + 64 hex → EVM candidates, bare 64 hex → Stellar first), probe Iris across candidate domains, derive the route from the response, check the nonce on chain, then run the tail of the same sequence with only the wallet the mint needs.

Every step transition writes the transfer record to the journal (localStorage, versioned, local only, clearable). On load, unfinished transfers are surfaced. Refresh mid transfer stops being dangerous.

## Errors

`translateError(raw, context)` maps every failure to a typed code with a plain language message and a concrete next step; the raw error stays available behind a details view. The attestation wait can never read as failure. Codes cover at minimum: user rejection, wrong network, insufficient USDC, insufficient gas, missing trustline, frozen trustline, trustline capacity, account not found, allowance expired, already minted, RPC unreachable, rate limited, max fee too low, invalid amount.

## Safety experiments

Claims that gate user facing copy are proven on testnet before the copy ships, tracked in `docs/experiments/2026-09-01-safety-experiments.md`: missing trustline mint reverts cleanly and stays retryable; nonexistent account behaves the same and sponsor creation from the submitter works; a week old standard attestation still mints; a seventh decimal burn truncates or rejects; muxed recipients; permissionless rescue on all three families; nonce read primitives. Read only experiments run as scripts under `scripts/experiments/`; the ones that need funded test wallets are scripted and documented so they can run as soon as funds exist.

## Out of scope here

The full preflight UI, the 24 chain EVM expansion, the rescue page with the raw message parser, mainnet enablement, WalletConnect, and the visual redesign all build on this foundation and are specified separately.
