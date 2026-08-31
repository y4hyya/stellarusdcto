import { Networks } from '@stellar/stellar-sdk';
import { defineChain } from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';
import type { Registry } from './types';

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
        {
            family: 'evm',
            id: 'arc',
            label: 'Arc Testnet',
            domain: 26,
            chain: arcTestnet,
            usdc: '0x3600000000000000000000000000000000000000',
            tokenMessenger: TOKEN_MESSENGER,
            messageTransmitter: MESSAGE_TRANSMITTER,
            explorer: 'https://testnet.arcscan.app',
            gasNote: 'Gas paid in USDC.',
            fastSource: false,
        },
        {
            family: 'evm',
            id: 'base',
            label: 'Base Sepolia',
            domain: 6,
            chain: baseSepolia,
            usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            tokenMessenger: TOKEN_MESSENGER,
            messageTransmitter: MESSAGE_TRANSMITTER,
            explorer: 'https://sepolia.basescan.org',
            gasNote: 'Gas paid in ETH.',
            attestationEtaMs: 15 * 60_000,
            fastSource: true,
        },
        {
            family: 'evm',
            id: 'ethereum',
            label: 'Ethereum Sepolia',
            domain: 0,
            chain: sepolia,
            usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
            tokenMessenger: TOKEN_MESSENGER,
            messageTransmitter: MESSAGE_TRANSMITTER,
            explorer: 'https://sepolia.etherscan.io',
            gasNote: 'Gas paid in ETH.',
            attestationEtaMs: 19 * 60_000,
            fastSource: true,
        },
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
        },
    ],
};
