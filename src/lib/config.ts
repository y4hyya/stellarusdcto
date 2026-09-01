// Compatibility layer over src/lib/registry. The registry is the source of
// truth; this file re derives the old names so existing modules keep working
// while they migrate. New code imports from $lib/registry directly. This file
// disappears once the migration lands.

import { getChain, getRegistry, stellarConfig } from './registry';
import type { EvmChainEntry, SolanaChainEntry, TransferSpeed } from './registry';

export { arcTestnet } from './registry/testnet';
export type { TransferSpeed };

const stellar = stellarConfig();
const solanaEntry = getChain('solana') as SolanaChainEntry;

export const STELLAR = {
    networkPassphrase: stellar.networkPassphrase,
    rpcUrl: stellar.rpcUrls[0],
    domain: stellar.domain,
    explorer: stellar.explorer,
    contracts: stellar.contracts,
    usdc: { code: stellar.usdc.code, issuer: stellar.usdc.issuer, decimals: 7 },
} as const;

export const SOLANA = {
    cluster: solanaEntry.cluster,
    rpcUrl: solanaEntry.rpcUrls[0],
    domain: solanaEntry.domain,
    explorer: solanaEntry.explorer,
    programs: {
        messageTransmitterV2: solanaEntry.messageTransmitter,
        tokenMessengerMinterV2: solanaEntry.tokenMessengerMinter,
    },
    usdc: { mint: solanaEntry.usdcMint, decimals: 6 },
} as const;

// Resolved from the ACTIVE registry, never a fixed one: this map feeds every
// EVM transaction the app signs, and pinning it to one environment once sent
// a mainnet mint to a testnet contract. Contracts are carried per chain
// because the pair is not uniform (EDGE mainnet runs its own deployment).
const evmEntries = getRegistry().chains.filter((c): c is EvmChainEntry => c.family === 'evm');

// Registry chain ids are open ended now that the roster covers all of CCTP.
export type EvmChainId = string;

export type EvmChainConfig = {
    id: EvmChainId;
    label: string;
    chain: EvmChainEntry['chain'];
    domain: number;
    explorer: string;
    usdc: `0x${string}`;
    usdcDecimals: number;
    tokenMessenger: `0x${string}`;
    messageTransmitter: `0x${string}`;
    gasNote: string;
    attestationEtaMs?: number;
};

export const EVM_CHAINS = Object.fromEntries(
    evmEntries.map((entry) => [
        entry.id,
        {
            id: entry.id as EvmChainId,
            label: entry.label,
            chain: entry.chain,
            domain: entry.domain,
            explorer: entry.explorer,
            usdc: entry.usdc,
            usdcDecimals: 6,
            tokenMessenger: entry.tokenMessenger,
            messageTransmitter: entry.messageTransmitter,
            gasNote: entry.gasNote,
            attestationEtaMs: entry.attestationEtaMs,
        } satisfies EvmChainConfig,
    ]),
) as Record<EvmChainId, EvmChainConfig>;

export const DEFAULT_EVM_CHAIN = getRegistry().defaultChainId as EvmChainId;

export const IRIS_API = getRegistry().irisBase;

// CCTP V2 finality thresholds for the burn.
//   STANDARD (2000) = wait for source chain finality. minimumFee is 0.
//   FAST     (1000) = mint before finality; Circle charges a fast fee
//                     (basis points of the amount) bounded by max_fee.
export const STANDARD_THRESHOLD = 2000;
export const FAST_THRESHOLD = 1000;
export const DEFAULT_SPEED: TransferSpeed = 'standard';

// Defensive max_fee buffers. The burn reverts with InsufficientMaxFee
// (#7105) if Circle's configured min_fee for the burn token exceeds this.
// Units: STELLAR_MAX_FEE is 7 decimal Stellar subunits (100_000 = $0.01);
// the others are canonical 6 decimal USDC units (500 = $0.0005).
export const STELLAR_MAX_FEE = 100_000n;
export const EVM_MAX_FEE = 500n;
export const SOLANA_MAX_FEE = 500n;

// ─────────────────────────────────────────────────────────────────────
//  Direction vocabulary (used consistently across this repo)
// ─────────────────────────────────────────────────────────────────────
// Two orthogonal axes, and mixing them is what makes this confusing:
//
//  1. Route, relative to Stellar. `outbound` leaves Stellar (Stellar burns),
//     `inbound` arrives on Stellar (Stellar mints). Only meaningful because
//     Stellar is this repo's fixed vantage point, so never use these two words
//     in a sentence that isn't about Stellar.
//  2. Role within a single transfer. `source` and `destination`, chain neutral,
//     matching CCTP's own field names (sourceDomain, destinationDomain). Attach
//     a chain with a clause ("when Stellar is the destination"), not a compound
//     ("Stellar-destination").
//
// `Direction` below is the third, fully explicit level: the concrete pair, used
// as a machine identifier where neither shorthand is wanted.
export type Direction =
    'stellar-to-evm' | 'evm-to-stellar' | 'solana-to-stellar' | 'stellar-to-solana';

// The right side chain in the main page selector: an EVM chain or Solana.
export type RightChain = EvmChainId | 'solana';

// Whether a burn from an EVM source lets the wallet bundle approve + burn
// behind one confirmation (EIP-5792) or runs them as two transactions.
export type InboundFlow = 'two-tx' | 'send-calls';
export const DEFAULT_INBOUND_FLOW: InboundFlow = 'two-tx';
export const DEFAULT_FORWARDING = false;
