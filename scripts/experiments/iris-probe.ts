// Resolve a burn hash to its route and attestation status with no prior
// knowledge of the source chain, exactly the way the resume flow does it.
// Run with: pnpm exec tsx scripts/experiments/iris-probe.ts <burnHash> [--mainnet]

import { candidateDomains, classifyHash } from '../../src/lib/engine/core';
import { MAINNET, TESTNET } from '../../src/lib/registry/index';

const args = process.argv.slice(2);
const hash = args.find((a) => !a.startsWith('--'));
const registry = args.includes('--mainnet') ? MAINNET : TESTNET;
if (!hash) {
    console.error('usage: tsx scripts/experiments/iris-probe.ts <burnHash> [--mainnet]');
    process.exit(2);
}

const classified = classifyHash(hash);
if (!classified) {
    console.error('not a recognizable transaction hash');
    process.exit(1);
}
console.log(`hash shape: ${classified.kind} (${registry.env}, ${registry.irisBase})`);

const domains = candidateDomains(classified.kind, registry);
console.log(`probing source domains: ${domains.join(', ')}`);

for (const domain of domains) {
    const url = `${registry.irisBase}/v2/messages/${domain}?transactionHash=${classified.normalized}`;
    const res = await fetch(url);
    if (res.status === 404) {
        console.log(`  domain ${domain}: not found`);
        continue;
    }
    if (!res.ok) {
        console.log(`  domain ${domain}: HTTP ${res.status}`);
        continue;
    }
    const body = (await res.json()) as {
        messages?: Array<{
            status?: string;
            cctpVersion?: number;
            eventNonce?: string;
            decodedMessage?: { sourceDomain?: string; destinationDomain?: string };
        }>;
    };
    const msg = body.messages?.[0];
    if (!msg) {
        console.log(`  domain ${domain}: empty response`);
        continue;
    }
    console.log(`  domain ${domain}: FOUND`);
    console.log(`    status:            ${msg.status}`);
    console.log(`    cctpVersion:       ${msg.cctpVersion}`);
    console.log(`    eventNonce:        ${msg.eventNonce}`);
    console.log(`    sourceDomain:      ${msg.decodedMessage?.sourceDomain}`);
    console.log(`    destinationDomain: ${msg.decodedMessage?.destinationDomain}`);
    process.exit(0);
}
console.log('no domain answered for this hash');
process.exit(1);
