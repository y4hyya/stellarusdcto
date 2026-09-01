import { Networks } from '@stellar/stellar-sdk';
import { defineChain, type Chain } from 'viem';
import {
    arbitrumSepolia,
    avalancheFuji,
    baseSepolia,
    codexTestnet,
    cronosTestnet,
    hyperliquidEvmTestnet,
    injectiveTestnet,
    inkSepolia,
    lineaSepolia,
    monadTestnet,
    optimismSepolia,
    plasmaTestnet,
    plumeSepolia,
    polygonAmoy,
    seiTestnet,
    sepolia,
    unichainSepolia,
    worldchainSepolia,
    xdcTestnet,
    xLayerTestnet,
} from 'viem/chains';
import type { EvmChainEntry, Registry } from './types';

// CCTP V2 testnet contracts share one address pair on every EVM testnet.
const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as const;
const MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as const;

// Arc is Circle's L1: EVM compatible, about 2s blocks, gas paid in USDC.
export const arcTestnet = defineChain({
    id: 5042002,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
    rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
    blockExplorers: { default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' } },
    testnet: true,
});

// Chains Circle lists that viem does not ship yet. Ids and RPCs verified
// against chainlist and probed live by scripts/check-chains.ts.
const edgeTestnet = defineChain({
    id: 33431,
    name: 'EDGE Testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://edge-testnet.g.alchemy.com/public'] } },
    blockExplorers: {
        default: { name: 'EDGE Explorer', url: 'https://edge-testnet.explorer.alchemy.com' },
    },
    testnet: true,
});

const morphHoodi = defineChain({
    id: 2910,
    name: 'Morph Hoodi',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc-hoodi.morphl2.io'] } },
    blockExplorers: {
        default: { name: 'Morph Hoodi Explorer', url: 'https://explorer-hoodi.morph.network' },
    },
    testnet: true,
});

// Sonic's Blaze testnet was retired upstream (its RPC is gone and dRPC has
// delisted it); the live Sonic Testnet is 14601 and carries both USDC and
// the CCTP contracts, verified by scripts/check-chains.ts. Circle's CCTP
// page still links Blaze; trust the chain, not the link.
const sonicTestnet14601 = defineChain({
    id: 14601,
    name: 'Sonic Testnet',
    nativeCurrency: { name: 'Sonic', symbol: 'S', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.testnet.soniclabs.com'] } },
    blockExplorers: { default: { name: 'SonicScan', url: 'https://testnet.sonicscan.org' } },
    testnet: true,
});

// Pharos (domain 31) is deliberately ABSENT: its only public testnet RPC
// (testnet.dplabs-internal.com) is unreachable or gated and dRPC has
// delisted the network, so an entry would ship broken. Re add it when a
// working endpoint verifies in scripts/check-chains.ts.

const MIN = 60_000;

// Compact builder: gas note comes from the chain's native currency, the
// explorer from the chain definition unless overridden, the contract pair
// from the shared testnet constants (per chain slots stay overridable for
// the day uniformity breaks again the way EDGE mainnet already did).
function evm(args: {
    id: string;
    label: string;
    domain: number;
    chain: Chain;
    usdc: `0x${string}`;
    accent: `#${string}`;
    attestationEtaMs?: number;
    fastSource?: boolean;
    explorer?: string;
    gasNote?: string;
}): EvmChainEntry {
    return {
        family: 'evm',
        id: args.id,
        label: args.label,
        domain: args.domain,
        chain: args.chain,
        usdc: args.usdc,
        tokenMessenger: TOKEN_MESSENGER,
        messageTransmitter: MESSAGE_TRANSMITTER,
        explorer: args.explorer ?? args.chain.blockExplorers?.default.url ?? '',
        gasNote: args.gasNote ?? `Gas paid in ${args.chain.nativeCurrency.symbol}.`,
        attestationEtaMs: args.attestationEtaMs,
        fastSource: args.fastSource ?? false,
        accent: args.accent,
    };
}

export const TESTNET: Registry = {
    env: 'testnet',
    irisBase: 'https://iris-api-sandbox.circle.com',
    stellar: {
        networkPassphrase: Networks.TESTNET,
        rpcUrls: ['https://soroban-testnet.stellar.org'],
        horizonUrl: 'https://horizon-testnet.stellar.org',
        domain: 27,
        explorer: 'https://stellar.expert/explorer/testnet',
        contracts: {
            tokenMessengerMinter: 'CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP',
            messageTransmitter: 'CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY',
            cctpForwarder: 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
            usdc: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
        },
        usdc: {
            code: 'USDC',
            issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        },
    },
    defaultChainId: 'arc',
    chains: [
        evm({
            id: 'arc',
            label: 'Arc Testnet',
            domain: 26,
            chain: arcTestnet,
            usdc: '0x3600000000000000000000000000000000000000',
            accent: '#3AC7B2',
            gasNote: 'Gas paid in USDC.',
        }),
        evm({
            id: 'base',
            label: 'Base Sepolia',
            domain: 6,
            chain: baseSepolia,
            usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            accent: '#0052FF',
            attestationEtaMs: 15 * MIN,
            fastSource: true,
            explorer: 'https://sepolia.basescan.org',
        }),
        evm({
            id: 'ethereum',
            label: 'Ethereum Sepolia',
            domain: 0,
            chain: sepolia,
            usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
            accent: '#627EEA',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
            explorer: 'https://sepolia.etherscan.io',
        }),
        {
            family: 'solana',
            id: 'solana',
            label: 'Solana Devnet',
            domain: 5,
            cluster: 'devnet',
            rpcUrls: ['https://api.devnet.solana.com'],
            usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
            messageTransmitter: 'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC',
            tokenMessengerMinter: 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe',
            explorer: 'https://explorer.solana.com',
            explorerSuffix: '?cluster=devnet',
            gasNote: 'Gas paid in SOL.',
            attestationEtaMs: 30_000,
            fastSource: true,
            accent: '#9945FF',
        },
        evm({
            id: 'arbitrum',
            label: 'Arbitrum Sepolia',
            domain: 3,
            chain: arbitrumSepolia,
            usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            accent: '#12AAFF',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'avalanche',
            label: 'Avalanche Fuji',
            domain: 1,
            chain: avalancheFuji,
            usdc: '0x5425890298aed601595a70AB815c96711a31Bc65',
            accent: '#E84142',
        }),
        evm({
            id: 'op',
            label: 'OP Sepolia',
            domain: 2,
            chain: optimismSepolia,
            usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
            accent: '#FF0420',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'polygon',
            label: 'Polygon Amoy',
            domain: 7,
            chain: polygonAmoy,
            usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
            accent: '#8247E5',
        }),
        evm({
            id: 'unichain',
            label: 'Unichain Sepolia',
            domain: 10,
            chain: unichainSepolia,
            usdc: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
            accent: '#F50DB4',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'linea',
            label: 'Linea Sepolia',
            domain: 11,
            chain: lineaSepolia,
            usdc: '0xFEce4462D57bD51A6A552365A011b95f0E16d9B7',
            accent: '#61DFFF',
            attestationEtaMs: 8 * 60 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'worldchain',
            label: 'World Chain Sepolia',
            domain: 14,
            chain: worldchainSepolia,
            usdc: '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88',
            accent: '#8E97A8',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'ink',
            label: 'Ink Sepolia',
            domain: 21,
            chain: inkSepolia,
            usdc: '0xFabab97dCE620294D2B0b0e46C68964e326300Ac',
            accent: '#7132F5',
            attestationEtaMs: 30 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'sonic',
            label: 'Sonic Testnet',
            domain: 13,
            chain: sonicTestnet14601,
            usdc: '0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51',
            accent: '#F0A33C',
        }),
        evm({
            id: 'monad',
            label: 'Monad Testnet',
            domain: 15,
            chain: monadTestnet,
            usdc: '0x534b2f3A21130d7a60830c2Df862319e593943A3',
            accent: '#836EF9',
        }),
        evm({
            id: 'sei',
            label: 'Sei Testnet',
            domain: 16,
            chain: seiTestnet,
            usdc: '0x4fCF1784B31630811181f670Aea7A7bEF803eaED',
            accent: '#B52C24',
        }),
        evm({
            id: 'hyperevm',
            label: 'HyperEVM Testnet',
            domain: 19,
            chain: hyperliquidEvmTestnet,
            usdc: '0x2B3370eE501B4a559b57D449569354196457D8Ab',
            accent: '#97FCE4',
            explorer: 'https://explore-testnet.hyperpc.app',
        }),
        evm({
            id: 'injective',
            label: 'Injective Testnet',
            domain: 29,
            chain: injectiveTestnet,
            usdc: '0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d',
            accent: '#00A3FF',
        }),
        evm({
            id: 'cronos',
            label: 'Cronos Testnet',
            domain: 32,
            chain: cronosTestnet,
            usdc: '0xEb33dc5fac03833e132593659e1dE7256aB59794',
            accent: '#3A7BD1',
        }),
        evm({
            id: 'plasma',
            label: 'Plasma Testnet',
            domain: 33,
            chain: plasmaTestnet,
            usdc: '0xE67Fb267022cBA8064Dd388CC2FED724F3120D9D',
            accent: '#37D9A0',
        }),
        evm({
            id: 'plume',
            label: 'Plume Testnet',
            domain: 22,
            chain: plumeSepolia,
            usdc: '0xcB5f30e335672893c7eb944B374c196392C19D18',
            accent: '#DE4F4F',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'codex',
            label: 'Codex Testnet',
            domain: 12,
            chain: codexTestnet,
            usdc: '0x6d7f141b6819C2c9CC2f818e6ad549E7Ca090F8f',
            accent: '#8A93F5',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'morph',
            label: 'Morph Hoodi',
            domain: 30,
            chain: morphHoodi,
            usdc: '0x7433b41C6c5e1d58D4Da99483609520255ab661B',
            accent: '#14C393',
            attestationEtaMs: 25 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'edge',
            label: 'EDGE Testnet',
            domain: 28,
            chain: edgeTestnet,
            usdc: '0x2d9F7CAD728051AA35Ecdc472a14cf8cDF5CFD6B',
            accent: '#E0B84C',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'xdc',
            label: 'XDC Apothem',
            domain: 18,
            chain: xdcTestnet,
            usdc: '0xb5AB69F7bBada22B28e79C8FFAECe55eF1c771D4',
            accent: '#3B7BD4',
        }),
        evm({
            id: 'xlayer',
            label: 'X Layer Testnet',
            domain: 37,
            chain: xLayerTestnet,
            usdc: '0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3',
            accent: '#D3D8E0',
            attestationEtaMs: 60 * MIN,
            fastSource: true,
        }),
    ],
};
