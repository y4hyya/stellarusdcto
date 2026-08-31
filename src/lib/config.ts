// Compatibility layer over src/lib/registry. The registry is the source of
// truth; this file re derives the old names so existing modules keep working
// while they migrate. New code imports from $lib/registry directly. This file
// disappears once the migration lands.

import { getChain, getRegistry, stellarConfig, TESTNET } from './registry';
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
    contracts: {
        ...stellar.contracts,
        // Demo era wrapper contract, on its way out with the wrapper flows.
        bridgeWrapper: 'CCR6VA3W3R3O23MEKY64J5ABIKB5MUTQYN5NVY4VE7FIZT7OTOELS5AE',
    },
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

const evmEntries = TESTNET.chains.filter((c): c is EvmChainEntry => c.family === 'evm');

export const EVM_CCTP_CONTRACTS = {
    tokenMessengerV2: evmEntries[0].tokenMessenger,
    messageTransmitterV2: evmEntries[0].messageTransmitter,
} as const;

export type EvmChainId = 'arc' | 'base' | 'ethereum';

export type EvmChainConfig = {
    id: EvmChainId;
    label: string;
    chain: EvmChainEntry['chain'];
    domain: number;
    explorer: string;
    usdc: `0x${string}`;
    usdcDecimals: number;
    gasNote: string;
    attestationEtaMs?: number;
    bridgeWrapper?: `0x${string}`;
};

// Demo era wrapper contract addresses, on their way out with the wrapper flows.
const WRAPPERS: Partial<Record<EvmChainId, `0x${string}`>> = {
    arc: '0xe87b2FCD2675f49785B46f5e84E1019961637eBd',
    base: '0xe87b2FCD2675f49785B46f5e84E1019961637eBd',
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
            gasNote: entry.gasNote,
            attestationEtaMs: entry.attestationEtaMs,
            bridgeWrapper: WRAPPERS[entry.id as EvmChainId],
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

// Transaction shape pickers from the demo era. The wrapper values are being
// removed with the wrapper flows.
export type OutboundFlow = 'wrapper' | 'two-tx';
export const DEFAULT_OUTBOUND_FLOW: OutboundFlow = 'two-tx';
export const DEFAULT_FORWARDING = false;
export type InboundFlow = 'wrapper' | 'two-tx' | 'send-calls';
export const DEFAULT_INBOUND_FLOW: InboundFlow = 'two-tx';
