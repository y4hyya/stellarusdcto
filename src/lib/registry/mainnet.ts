import { Networks } from '@stellar/stellar-sdk';
import { base, mainnet } from 'viem/chains';
import type { Registry } from './types';

// CCTP V2 mainnet contracts share one address pair on every EVM mainnet
// today, with EDGE as the single known exception (different addresses, add
// per chain when EDGE lands). Values sourced from Circle's contract address
// reference; the registry check script re verifies them against the live docs.
const TOKEN_MESSENGER = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' as const;
const MESSAGE_TRANSMITTER = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64' as const;

// This registry is data groundwork: it is not reachable from the UI until
// mainnet routes are verified end to end with real transfers. Arc mainnet is
// intentionally absent until Circle publishes its parameters.
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
        {
            family: 'evm',
            id: 'base',
            label: 'Base',
            domain: 6,
            chain: base,
            usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            tokenMessenger: TOKEN_MESSENGER,
            messageTransmitter: MESSAGE_TRANSMITTER,
            explorer: 'https://basescan.org',
            gasNote: 'Gas paid in ETH.',
            attestationEtaMs: 19 * 60_000,
            fastSource: true,
            accent: '#0052FF',
        },
        {
            family: 'evm',
            id: 'ethereum',
            label: 'Ethereum',
            domain: 0,
            chain: mainnet,
            usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            tokenMessenger: TOKEN_MESSENGER,
            messageTransmitter: MESSAGE_TRANSMITTER,
            explorer: 'https://etherscan.io',
            gasNote: 'Gas paid in ETH.',
            attestationEtaMs: 19 * 60_000,
            fastSource: true,
            accent: '#627EEA',
        },
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
    ],
};
