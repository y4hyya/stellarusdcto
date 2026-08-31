# stellarusdcto

A SvelteKit app that bridges native USDC between **Stellar** and
CCTP-supported chains (Arc Testnet, Base Sepolia, Ethereum Sepolia, and
Solana devnet today, with the rest of the CCTP V2 roster on the way) using
Circle's [Cross-Chain Transfer Protocol V2](https://developers.circle.com/cctp).

Every step stays visible: the **burn** on the source chain, Circle's
**attestation**, and the **mint** on the destination chain, all in one
screen. Both directions are supported, transfers survive a refresh, and any
interrupted CCTP transfer can be completed from just its burn hash.

Built on [Elliot Friend's stellar-cctp-demo](https://github.com/ElliotFriend/stellar-cctp-demo) (MIT).

```bash
pnpm install
pnpm run dev
```

Open `http://localhost:5173`.

## Why Arc by default

Arc is Circle's own EVM-compatible L1, designed for stablecoin payments. Two
practical wins for this demo:

- **Fast finality.** Arc's settlement is much quicker than Base→Sepolia, so
  the attestation step takes seconds rather than ~15 minutes.
- **Gas in USDC.** No separate ETH balance to top up; the same USDC pays for
  gas and the burn.

You can flip to Base Sepolia at any time via the picker in the EVM panel.

## What you need

- **Freighter** browser extension, set to the Stellar **Testnet** network ([install](https://freighter.app)).
- **MetaMask** (or any injected EVM wallet). Arc Testnet is added on first connect; for Base Sepolia your wallet probably already has it.
- Testnet USDC on each side; on Base Sepolia you also need a tiny bit of ETH for gas.

Every flow uses Circle's own CCTP contracts directly, so there is nothing
to deploy. The `contracts/` directory holds earlier wrapper experiments that
the app no longer uses.

## Faucets

| You need                | Where                                                |
| ----------------------- | ---------------------------------------------------- |
| Testnet XLM             | <https://lab.stellar.org/account/fund>               |
| Testnet USDC on Stellar | <https://faucet.circle.com> (pick "Stellar Testnet") |
| Testnet USDC on Arc     | <https://faucet.circle.com> (pick "Arc Testnet")     |
| Testnet USDC on Base    | <https://faucet.circle.com> (pick "Base Sepolia")    |
| Base Sepolia ETH        | <https://www.alchemy.com/faucets/base-sepolia>       |

You'll also need a USDC trustline on your Stellar testnet account before
USDC can land. Freighter or LOBSTR will prompt you to add it on first
deposit.

## Network details

| Chain           | Chain ID | RPC                                   | Explorer                                  | CCTP domain |
| --------------- | -------- | ------------------------------------- | ----------------------------------------- | ----------- |
| Arc Testnet     | 5042002  | <https://rpc.testnet.arc.network>     | <https://testnet.arcscan.app>             | 26          |
| Base Sepolia    | 84532    | (your wallet's default)               | <https://sepolia.basescan.org>            | 6           |
| Stellar Testnet | n/a      | <https://soroban-testnet.stellar.org> | <https://stellar.expert/explorer/testnet> | 27          |

## How it works

CCTP burns USDC on the source chain and mints fresh USDC on the destination.
No liquidity pools, no wrapped tokens.

**A note on direction.** Two words do a lot of work in this repo and in the code
comments, so they're worth pinning down. **Outbound** means USDC leaving Stellar,
so Stellar is the burn source. **Inbound** means USDC arriving on Stellar, so
Stellar is the mint destination. Those two only make sense because Stellar is
this demo's fixed vantage point. Everywhere else (a domain id, a contract
argument, a chain that isn't Stellar) it's plain **source** and **destination**,
used the same way [Circle's docs](https://developers.circle.com/cctp) use them.
When a chain needs naming in that role, it gets a clause ("when Stellar is the
destination") rather than a compound.

Three contracts are involved on Stellar:

| Contract                             | Purpose                                          |
| ------------------------------------ | ------------------------------------------------ |
| `TokenMessengerMinter` (`CDNG…RTHP`) | Burns USDC outbound, mints inbound               |
| `MessageTransmitter` (`CBJ6…VVJY`)   | Generic message bus + attestation verifier       |
| `CctpForwarder` (`CA66…4VSZ`)        | Routes inbound USDC to a regular Stellar account |

On every EVM chain, CCTP V2 deploys to the same addresses (deterministic
across the entire CCTP V2 testnet fleet):

- `TokenMessengerV2` = `0x8FE6…2DAA`
- `MessageTransmitterV2` = `0xE737…E275`

Only USDC and the chain ID/domain differ per chain.

### Stellar → EVM

Plain CCTP:

1. `approve` USDC SAC for the `TokenMessengerMinter` (skipped when the
   allowance already covers the amount).
2. Call `deposit_for_burn` on `TokenMessengerMinter`.
3. Poll Iris for the attestation.
4. Call `receiveMessage` on the destination's `MessageTransmitterV2`.

An optional forwarding toggle tags the burn for Circle's relayer, which
then mints on the destination with no destination gas needed; the relayer
fee comes out of the minted USDC. `destination_caller` stays zero either
way, so a manual mint can always finish the transfer.

### EVM → Stellar

This direction needs the `CctpForwarder` because CCTP messages can't tell a
G-account from a C-contract, so sending directly to a G-address would brick
the funds. The destination side always looks the same:

- Poll Iris (~seconds on Arc; ~15 min on Base for Standard transfers).
- Call `mint_and_forward` on the `CctpForwarder`, which atomically mints to the
  forwarder and pays out to the G-address from hook data.

The hook data layout (24 zero bytes + `uint32` version + `uint32` length +
UTF-8 strkey) lives in `src/lib/adapters/stellar.ts`, composed in exactly one
tested place. Get it wrong and funds are lost, so it's the most important
code in the repo.

The burn side offers two shapes, both calling
`TokenMessengerV2.depositForBurnWithHook` with the same payload:

- **2 tx (direct)**: `usdc.approve` + `depositForBurnWithHook`.
- **1 click (sendCalls)**: [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792)
  `wallet_sendCalls`, where the **wallet** bundles both calls behind one
  confirmation. Atomic on smart wallets and EIP-7702 accounts, sequential on
  plain EOAs. The chip auto-disables where unsupported.

### Resuming any transfer

Every transfer is journaled locally, so a refresh mid transfer is safe and
unfinished transfers surface on the next visit. The resume box also accepts
any burn transaction hash, even from other tools: the source chain is
detected from the hash shape, the route comes back from Iris, and minting is
permissionless.

## Limitations

Still on the way to a full product:

- USDC only (EURC isn't confirmed on Stellar CCTP yet).
- Testnet only for now; the mainnet registry exists but is not yet enabled.
- Three EVM chains + Solana today; the full CCTP V2 chain roster lands with
  the registry expansion.
- No mobile wallet flow beyond what the injected wallet provides.

## Layout

```text
src/lib/
  registry/                    # every chain as data (testnet + mainnet), the single source of truth
  adapters/                    # per family chain adapters; mintTarget owns the forwarder invariant
  engine/                      # the one transfer engine: preflight, approve, burn, attest, mint
  errors/                      # typed error codes + raw error translation to plain language
  journal/                     # localStorage transfer journal behind resume and history
  amounts.ts                   # strict USDC amount parsing, 6 decimal canonical units
  stellar/  evm/  solana/      # low level chain calls (wallets, burns, mints, reads)
  circle/                      # Iris attestation polling + fee quotes
  components/                  # one .svelte file per UI piece
src/routes/+page.svelte        # composition
scripts/check-circle-docs.ts   # CI diff of the registry against Circle's docs
scripts/experiments/           # on chain safety experiments (see docs/experiments)
```
