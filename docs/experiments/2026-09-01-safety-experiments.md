# Safety experiments

The product promises that no known footgun can strand funds and that any
transfer can be completed from its burn hash. Every claim behind that copy
gets proven on testnet before the copy ships. This doc tracks the proofs.

Scripts live in `scripts/experiments/`. Run with
`pnpm exec tsx scripts/experiments/<name>.ts <burnHash> [--mainnet]`.

## Verified 2026-09-01

### Route and status resolve from a bare hash (`iris-probe.ts`)

Input was only `0d4fcd21…09aa` (a July Stellar burn from
`2026-06-24-forwarder-stellar-source.md`), no chain named. The hash shape
classifier narrowed the probe to domain 27; Iris answered with the full
route (source 27 → destination 5), `status: complete`, `cctpVersion: 2` and
the event nonce. This is the exact pipeline the resume flow uses.

### Minted proof works on all three families (`nonce-used.ts`)

Iris `status: complete` only means attested, so the app reads the
destination chain before offering a mint:

- Solana: the `used_nonce` account `HR3GTn6QpkdRnhggzidFZ8cagqP5py3q2RiGi16mgrsS`
  for the transfer above exists on devnet → minted. ✔
- EVM: burn `245956ca…cd42` (Stellar → Arc, July) reads `usedNonces = 1` on
  Arc Testnet's MessageTransmitterV2 → minted. ✔
- Stellar: `is_nonce_used` simulates cleanly through the public RPC using the
  USDC issuer account as the viewer, and returns `false` for a nonce that was
  never delivered to Stellar. ✔ The `true` case still needs a completed
  inbound burn hash (any EVM → Stellar transfer; see below).

### Registry drift watchdog (`../check-circle-docs.ts`)

Live run against Circle's docs: 30 domains listed, 30 triaged, both uniform
contract address pairs still present. Wired into the weekly
`registry-check` workflow.

## Waiting on funded test wallets

These need testnet USDC (Circle's faucet is captcha gated) plus gas on an
EVM testnet and XLM on throwaway Stellar accounts. Each is written so one
sitting completes it; results get recorded here before the related UI copy
ships.

### 1. Missing trustline mint is atomic and retryable (the stranding question)

1. Create a fresh Stellar testnet account (friendbot), do NOT add a USDC
   trustline.
2. Burn 1 USDC on Base Sepolia or Arc Testnet toward that account through the
   app (the burn builder puts the CctpForwarder in both slots).
3. After attestation, submit `mint_and_forward` from any funded account.
   Expected: simulation fails before submission (no fee lost), nothing mints,
   `is_nonce_used` stays false.
4. Add the USDC trustline to the recipient, resubmit the SAME message and
   attestation. Expected: mint lands, `is_nonce_used` flips true.
5. Repeat with a recipient account that does not exist at all, and again
   after sponsor creating the account + trustline from the submitter wallet
   (begin/end sponsoring sandwich) to prove the zero XLM recipient rescue.

### 2. Seventh decimal burn behavior

`deposit_for_burn` on Stellar testnet with amount `1234567` subunits (not a
multiple of 10). Expected per Circle's docs: only `123456` six decimal units
wire over and the seventh digit stays with the sender, but truncate vs
reject is undocumented. The UI quantizes either way; the result decides the
error copy.

### 3. Muxed (M address) recipient

Burn toward Stellar with an M strkey in hook data. Questions: does the
forwarder accept it, and does the payout carry the mux id (exchange deposit
routing) or strip to the underlying G. Decides whether the recipient field
may accept M addresses.

### 4. Aged attestation mint

Leave an attested standard transfer unminted for a week, then complete it.
`expirationBlock` was `0` on observed standard transfers, which means no
expiry, but the "complete any old burn" promise stays soft until this runs.

### 5. Stellar source forwarding on mainnet

The fee API quotes 27 → x forwarding on production and testnet delivery was
verified in July, but the repo's own experiment proved a quoted route can
still be ignored by the relayer. One small real mainnet transfer decides
whether the auto delivery toggle ships on mainnet.
