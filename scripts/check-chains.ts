// Empirical verification of the registry: for every EVM entry, prove the
// RPC answers with the expected chain id, that the USDC token and the CCTP
// TokenMessengerV2 actually have code at the configured addresses, and that
// Circle's fee API quotes the domain against Stellar (27).
// Run with: pnpm exec tsx scripts/check-chains.ts [--mainnet]

import { MAINNET, TESTNET } from '../src/lib/registry/index';
import type { EvmChainEntry } from '../src/lib/registry/types';

const registry = process.argv.includes('--mainnet') ? MAINNET : TESTNET;
console.log(`verifying the ${registry.env} registry\n`);
const evmChains = registry.chains.filter((c): c is EvmChainEntry => c.family === 'evm');

async function rpc(url: string, method: string, params: unknown[]): Promise<string> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { result?: string; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message ?? 'rpc error');
    if (typeof body.result !== 'string') throw new Error('no result');
    return body.result;
}

let failures = 0;

for (const entry of evmChains) {
    const url = entry.chain.rpcUrls.default.http[0];
    const problems: string[] = [];
    try {
        const chainIdHex = await rpc(url, 'eth_chainId', []);
        const chainId = parseInt(chainIdHex, 16);
        if (chainId !== entry.chain.id) {
            problems.push(`chain id ${chainId}, expected ${entry.chain.id}`);
        }
        const usdcCode = await rpc(url, 'eth_getCode', [entry.usdc, 'latest']);
        if (usdcCode.length <= 2) problems.push('USDC address has NO code');
        const tmCode = await rpc(url, 'eth_getCode', [entry.tokenMessenger, 'latest']);
        if (tmCode.length <= 2) problems.push('TokenMessengerV2 has NO code');
    } catch (err) {
        problems.push(`rpc unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
        const fee = await fetch(`${registry.irisBase}/v2/burn/USDC/fees/${entry.domain}/27`, {
            signal: AbortSignal.timeout(15_000),
        });
        if (!fee.ok) {
            problems.push(`fee API ${fee.status} for domain ${entry.domain} → 27`);
        } else {
            const rows = (await fee.json()) as unknown[];
            if (!Array.isArray(rows) || rows.length === 0) problems.push('fee API empty');
        }
    } catch (err) {
        problems.push(`fee API unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (problems.length === 0) {
        console.log(
            `ok   ${entry.id.padEnd(11)} domain ${String(entry.domain).padEnd(3)} chain ${entry.chain.id}`,
        );
    } else {
        failures++;
        console.error(`FAIL ${entry.id.padEnd(11)} ${problems.join(' · ')}`);
    }
    // Stay far under Circle's 40 req/s and be polite to public RPCs.
    await new Promise((resolve) => setTimeout(resolve, 250));
}

if (failures > 0) {
    console.error(`\n${failures} of ${evmChains.length} chains failed verification`);
    process.exit(1);
}
console.log(`\nall ${evmChains.length} EVM ${registry.env} chains verified`);
