import type { Chain } from 'viem';

// The registry is the single source of chain truth. One registry per network
// environment, swapped wholesale: the Iris host, contract addresses, USDC ids
// and the chain list always travel together, so testnet and mainnet values can
// never mix. Adding a chain is a data edit here plus a smoke test.

export type NetworkEnv = 'testnet' | 'mainnet';
export type VmFamily = 'evm' | 'solana' | 'stellar';
export type TransferSpeed = 'standard' | 'fast';

export type EvmChainEntry = {
    family: 'evm';
    id: string;
    label: string;
    /** Circle issued CCTP domain. Not the EVM chain id. */
    domain: number;
    chain: Chain;
    usdc: `0x${string}`;
    /**
     * CCTP V2 contracts. Uniform per environment across EVM chains today,
     * but stored per chain because uniformity is observed, not guaranteed
     * (EDGE mainnet already deviates).
     */
    tokenMessenger: `0x${string}`;
    messageTransmitter: `0x${string}`;
    explorer: string;
    gasNote: string;
    /** Rough attestation wait when this chain is the source. Undefined means seconds. */
    attestationEtaMs?: number;
    /** Whether Circle offers Fast Transfer with this chain as the source. */
    fastSource: boolean;
    /** Badge color for this chain in the UI. */
    accent: `#${string}`;
};

export type SolanaChainEntry = {
    family: 'solana';
    id: 'solana';
    label: string;
    domain: number;
    /** Wallet Standard chain suffix: solana:<cluster>. */
    cluster: 'devnet' | 'mainnet';
    rpcUrls: string[];
    usdcMint: string;
    messageTransmitter: string;
    tokenMessengerMinter: string;
    explorer: string;
    /** Query string appended to explorer links, e.g. ?cluster=devnet. */
    explorerSuffix: string;
    gasNote: string;
    attestationEtaMs?: number;
    fastSource: boolean;
    /** Badge color for this chain in the UI. */
    accent: `#${string}`;
};

export type ChainEntry = EvmChainEntry | SolanaChainEntry;

export type StellarConfig = {
    networkPassphrase: string;
    rpcUrls: string[];
    horizonUrl: string;
    domain: number;
    explorer: string;
    contracts: {
        tokenMessengerMinter: string;
        messageTransmitter: string;
        cctpForwarder: string;
        usdc: string;
    };
    usdc: {
        code: 'USDC';
        issuer: string;
    };
};

export type Registry = {
    env: NetworkEnv;
    irisBase: string;
    stellar: StellarConfig;
    /** Counterparty chains. Stellar itself never appears here. */
    chains: ChainEntry[];
    defaultChainId: string;
};
