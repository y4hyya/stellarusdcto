// Prove the on chain "was this transfer minted" primitives on real
// transfers: usedNonces on EVM, is_nonce_used on Stellar, the used_nonce
// account on Solana. Iris status never says minted, so these reads are what
// the app trusts before offering a mint.
// Run with: pnpm exec tsx scripts/experiments/nonce-used.ts <burnHash> [--mainnet]

import {
    Account,
    BASE_FEE,
    Contract,
    TransactionBuilder,
    nativeToScVal,
    scValToNative,
    rpc,
} from '@stellar/stellar-sdk';
import { createPublicClient, hexToBytes, http, type Hex } from 'viem';
import { createSolanaRpc, getProgramDerivedAddress, address as solAddress } from '@solana/kit';
import { candidateDomains, classifyHash } from '../../src/lib/engine/core';
import { MAINNET, TESTNET } from '../../src/lib/registry/index';
import type { EvmChainEntry, SolanaChainEntry } from '../../src/lib/registry/types';

const args = process.argv.slice(2);
const hash = args.find((a) => !a.startsWith('--'));
const registry = args.includes('--mainnet') ? MAINNET : TESTNET;
if (!hash) {
    console.error('usage: tsx scripts/experiments/nonce-used.ts <burnHash> [--mainnet]');
    process.exit(2);
}

const classified = classifyHash(hash);
if (!classified) throw new Error('not a recognizable transaction hash');

// 1. Find the message on Iris.
let found: {
    domain: number;
    nonce: string;
    destinationDomain: number;
    status: string;
} | null = null;
for (const domain of candidateDomains(classified.kind, registry)) {
    const res = await fetch(
        `${registry.irisBase}/v2/messages/${domain}?transactionHash=${classified.normalized}`,
    );
    if (!res.ok) continue;
    const body = (await res.json()) as {
        messages?: Array<{
            status?: string;
            eventNonce?: string;
            decodedMessage?: { destinationDomain?: string };
        }>;
    };
    const msg = body.messages?.[0];
    if (msg?.eventNonce) {
        found = {
            domain,
            nonce: msg.eventNonce,
            destinationDomain: Number(msg.decodedMessage?.destinationDomain),
            status: msg.status ?? 'unknown',
        };
        break;
    }
}
if (!found) throw new Error('Iris has no record of this burn on any candidate domain');
console.log(
    `found: source domain ${found.domain}, destination domain ${found.destinationDomain}, ` +
        `status ${found.status}, nonce ${found.nonce}`,
);

// 2. Ask the destination chain whether the nonce was consumed.
const nonceHex = found.nonce as Hex;
const dest = found.destinationDomain;

if (dest === registry.stellar.domain) {
    // Simulation needs an existing source account; the USDC issuer account is
    // a convenient always existing viewer.
    const viewer = registry.stellar.usdc.issuer;
    const server = new rpc.Server(registry.stellar.rpcUrls[0]);
    const mt = new Contract(registry.stellar.contracts.messageTransmitter);
    const account = await server.getAccount(viewer).catch(() => new Account(viewer, '0'));
    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: registry.stellar.networkPassphrase,
    })
        .addOperation(
            mt.call('is_nonce_used', nativeToScVal(hexToBytes(nonceHex), { type: 'bytes' })),
        )
        .setTimeout(30)
        .build();
    const sim = await server.simulateTransaction(tx);
    if ('error' in sim && sim.error) throw new Error(`simulation failed: ${sim.error}`);
    const retval = (sim as { result?: { retval: unknown } }).result?.retval;
    console.log(`stellar is_nonce_used: ${scValToNative(retval as never)}`);
} else {
    const entry = registry.chains.find((c) => c.domain === dest);
    if (!entry)
        throw new Error(`destination domain ${dest} is not in the ${registry.env} registry`);
    if (entry.family === 'evm') {
        const evm = entry as EvmChainEntry;
        const client = createPublicClient({ chain: evm.chain, transport: http() });
        const used = await client.readContract({
            address: evm.messageTransmitter,
            abi: [
                {
                    type: 'function',
                    name: 'usedNonces',
                    stateMutability: 'view',
                    inputs: [{ name: 'nonce', type: 'bytes32' }],
                    outputs: [{ type: 'uint256' }],
                } as const,
            ],
            functionName: 'usedNonces',
            args: [nonceHex],
        });
        console.log(`${evm.id} usedNonces: ${used} (${used === 1n ? 'MINTED' : 'not minted'})`);
    } else {
        const sol = entry as SolanaChainEntry;
        const [usedNonce] = await getProgramDerivedAddress({
            programAddress: solAddress(sol.messageTransmitter),
            seeds: ['used_nonce', hexToBytes(nonceHex)],
        });
        const rpcClient = createSolanaRpc(sol.rpcUrls[0]);
        const info = await rpcClient.getAccountInfo(usedNonce, { encoding: 'base64' }).send();
        console.log(
            `solana used_nonce account ${usedNonce}: ${info.value ? 'exists (MINTED)' : 'absent (not minted)'}`,
        );
    }
}
