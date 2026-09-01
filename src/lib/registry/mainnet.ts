import { Networks } from '@stellar/stellar-sdk';
import { defineChain, type Chain } from 'viem';
import {
    arbitrum,
    avalanche,
    base,
    codex,
    cronos,
    injective,
    ink,
    linea,
    mainnet,
    monad,
    morph,
    optimism,
    plasma,
    plumeMainnet,
    polygon,
    sei,
    sonic,
    unichain,
    worldchain,
    xdc,
    xLayer,
} from 'viem/chains';
import type { EvmChainEntry, Registry } from './types';

// CCTP V2 mainnet contracts share one address pair on every EVM mainnet,
// with EDGE as the single exception (its own pair, below). Values come from
// Circle's contract address reference and are probed live by
// scripts/check-chains.ts --mainnet before any of this reaches users.
const TOKEN_MESSENGER = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' as const;
const MESSAGE_TRANSMITTER = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64' as const;

// EDGE runs its own deployment of the V2 contracts.
const EDGE_TOKEN_MESSENGER = '0x98706A006bc632Df31CAdFCBD43F38887ce2ca5c' as const;
const EDGE_MESSAGE_TRANSMITTER = '0x5b61381Fc9e58E70EfC13a4A97516997019198ee' as const;

// Chains Circle lists that viem does not ship. Ids verified by the probe.
const edgeMainnet = defineChain({
    id: 3343,
    name: 'EDGE',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://edge-mainnet.g.alchemy.com/public'] } },
    blockExplorers: { default: { name: 'edgeX Explorer', url: 'https://pro.edgex.exchange' } },
    testnet: false,
});

const hyperEvm = defineChain({
    id: 999,
    name: 'HyperEVM',
    nativeCurrency: { name: 'Hyperliquid', symbol: 'HYPE', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
    blockExplorers: { default: { name: 'Hyperscan', url: 'https://hyperscan.com' } },
    testnet: false,
});

const pharosMainnet = defineChain({
    id: 1672,
    name: 'Pharos',
    nativeCurrency: { name: 'Pharos', symbol: 'PROS', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.pharos.xyz'] } },
    blockExplorers: { default: { name: 'PharosScan', url: 'https://pharos.socialscan.io' } },
    testnet: false,
});

const MIN = 60_000;

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
    tokenMessenger?: `0x${string}`;
    messageTransmitter?: `0x${string}`;
}): EvmChainEntry {
    return {
        family: 'evm',
        id: args.id,
        label: args.label,
        domain: args.domain,
        chain: args.chain,
        usdc: args.usdc,
        tokenMessenger: args.tokenMessenger ?? TOKEN_MESSENGER,
        messageTransmitter: args.messageTransmitter ?? MESSAGE_TRANSMITTER,
        explorer: args.explorer ?? args.chain.blockExplorers?.default.url ?? '',
        gasNote: args.gasNote ?? `Gas paid in ${args.chain.nativeCurrency.symbol}.`,
        attestationEtaMs: args.attestationEtaMs,
        fastSource: args.fastSource ?? false,
        accent: args.accent,
    };
}

// Arc mainnet is intentionally absent until Circle publishes its parameters
// (expected at the 2026-09-16 launch). Pharos exists here but not on
// testnet: its mainnet RPC answers, its testnet RPC does not.
export const MAINNET: Registry = {
    env: 'mainnet',
    irisBase: 'https://iris-api.circle.com',
    stellar: {
        networkPassphrase: Networks.PUBLIC,
        rpcUrls: [
            'https://mainnet.sorobanrpc.com',
            'https://soroban-rpc.mainnet.stellar.gateway.fm',
            'https://rpc.lightsail.network',
        ],
        horizonUrl: 'https://horizon.stellar.org',
        domain: 27,
        explorer: 'https://stellar.expert/explorer/public',
        contracts: {
            tokenMessengerMinter: 'CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL',
            messageTransmitter: 'CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV',
            cctpForwarder: 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T',
            usdc: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
        },
        usdc: {
            code: 'USDC',
            issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        },
    },
    defaultChainId: 'base',
    chains: [
        evm({
            id: 'base',
            label: 'Base',
            domain: 6,
            chain: base,
            usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            accent: '#0052FF',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
            explorer: 'https://basescan.org',
        }),
        evm({
            id: 'ethereum',
            label: 'Ethereum',
            domain: 0,
            chain: mainnet,
            usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            accent: '#627EEA',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
            explorer: 'https://etherscan.io',
        }),
        {
            family: 'solana',
            id: 'solana',
            label: 'Solana',
            domain: 5,
            cluster: 'mainnet',
            rpcUrls: ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'],
            usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            messageTransmitter: 'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC',
            tokenMessengerMinter: 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe',
            explorer: 'https://explorer.solana.com',
            explorerSuffix: '',
            gasNote: 'Gas paid in SOL.',
            attestationEtaMs: 30_000,
            fastSource: true,
            accent: '#9945FF',
        },
        evm({
            id: 'arbitrum',
            label: 'Arbitrum',
            domain: 3,
            chain: arbitrum,
            usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
            accent: '#12AAFF',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'avalanche',
            label: 'Avalanche',
            domain: 1,
            chain: avalanche,
            usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
            accent: '#E84142',
        }),
        evm({
            id: 'op',
            label: 'OP Mainnet',
            domain: 2,
            chain: optimism,
            usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
            accent: '#FF0420',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'polygon',
            label: 'Polygon PoS',
            domain: 7,
            chain: polygon,
            usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
            accent: '#8247E5',
        }),
        evm({
            id: 'unichain',
            label: 'Unichain',
            domain: 10,
            chain: unichain,
            usdc: '0x078D782b760474a361dDA0AF3839290b0EF57AD6',
            accent: '#F50DB4',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'linea',
            label: 'Linea',
            domain: 11,
            chain: linea,
            usdc: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
            accent: '#61DFFF',
            attestationEtaMs: 8 * 60 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'worldchain',
            label: 'World Chain',
            domain: 14,
            chain: worldchain,
            usdc: '0x79A02482A880bCe3F13E09da970dC34dB4cD24D1',
            accent: '#8E97A8',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'ink',
            label: 'Ink',
            domain: 21,
            chain: ink,
            usdc: '0x2D270e6886d130D724215A266106e6832161EAEd',
            accent: '#7132F5',
            attestationEtaMs: 30 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'sonic',
            label: 'Sonic',
            domain: 13,
            chain: sonic,
            usdc: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894',
            accent: '#F0A33C',
        }),
        evm({
            id: 'monad',
            label: 'Monad',
            domain: 15,
            chain: monad,
            usdc: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
            accent: '#836EF9',
        }),
        evm({
            id: 'sei',
            label: 'Sei',
            domain: 16,
            chain: sei,
            usdc: '0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392',
            accent: '#B52C24',
        }),
        evm({
            id: 'hyperevm',
            label: 'HyperEVM',
            domain: 19,
            chain: hyperEvm,
            usdc: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
            accent: '#97FCE4',
        }),
        evm({
            id: 'injective',
            label: 'Injective',
            domain: 29,
            chain: injective,
            usdc: '0xa00C59fF5a080D2b954d0c75e46E22a0c371235a',
            accent: '#00A3FF',
        }),
        evm({
            id: 'cronos',
            label: 'Cronos',
            domain: 32,
            chain: cronos,
            usdc: '0x3D7F2C478aAfdB65542BCB44bCeeC05849999d2D',
            accent: '#3A7BD1',
        }),
        evm({
            id: 'plasma',
            label: 'Plasma',
            domain: 33,
            chain: plasma,
            usdc: '0x2d661C89D812261039AF9764eceaAee884f5F67F',
            accent: '#37D9A0',
        }),
        evm({
            id: 'plume',
            label: 'Plume',
            domain: 22,
            chain: plumeMainnet,
            usdc: '0x222365EF19F7947e5484218551B56bb3965Aa7aF',
            accent: '#DE4F4F',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'codex',
            label: 'Codex',
            domain: 12,
            chain: codex,
            usdc: '0xd996633a415985DBd7D6D12f4A4343E31f5037cf',
            accent: '#8A93F5',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'morph',
            label: 'Morph',
            domain: 30,
            chain: morph,
            usdc: '0xCfb1186F4e93D60E60a8bDd997427D1F33bc372B',
            accent: '#14C393',
            attestationEtaMs: 25 * MIN,
            fastSource: true,
        }),
        evm({
            id: 'edge',
            label: 'EDGE',
            domain: 28,
            chain: edgeMainnet,
            usdc: '0x98d2919b9A214E6Fa5384AC81E6864bA686Ad74c',
            accent: '#E0B84C',
            attestationEtaMs: 19 * MIN,
            fastSource: true,
            tokenMessenger: EDGE_TOKEN_MESSENGER,
            messageTransmitter: EDGE_MESSAGE_TRANSMITTER,
        }),
        evm({
            id: 'pharos',
            label: 'Pharos',
            domain: 31,
            chain: pharosMainnet,
            usdc: '0xC879C018dB60520F4355C26eD1a6D572cdAC1815',
            accent: '#4FB8E8',
        }),
        evm({
            id: 'xdc',
            label: 'XDC',
            domain: 18,
            chain: xdc,
            usdc: '0xfA2958CB79b0491CC627c1557F441eF849Ca8eb1',
            accent: '#3B7BD4',
        }),
        evm({
            id: 'xlayer',
            label: 'X Layer',
            domain: 37,
            chain: xLayer,
            usdc: '0xB6CEceAB302E2E4948951eE7843FC24E92933061',
            accent: '#D3D8E0',
            attestationEtaMs: 60 * MIN,
            fastSource: true,
        }),
    ],
};
