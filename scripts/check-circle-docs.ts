// Diffs Circle's machine readable CCTP docs against the bundled registry.
// Run with: pnpm exec tsx scripts/check-circle-docs.ts
// Exits nonzero on drift so CI surfaces it: a new domain appeared, a triaged
// domain vanished, or the uniform contract address pairs changed.

import { MAINNET, TESTNET } from '../src/lib/registry/index';

const SUPPORTED_URL = 'https://developers.circle.com/cctp/concepts/supported-chains-and-domains.md';
const CONTRACTS_URL = 'https://developers.circle.com/cctp/references/contract-addresses.md';

// Every CCTP V2 domain this project has triaged, whether or not the app
// ships it yet. A domain in Circle's table that is missing here is exactly
// the signal this check exists to raise.
const TRIAGED_DOMAINS: Record<number, string> = {
    0: 'Ethereum',
    1: 'Avalanche',
    2: 'OP Mainnet',
    3: 'Arbitrum',
    5: 'Solana',
    6: 'Base',
    7: 'Polygon PoS',
    9: 'Aptos',
    10: 'Unichain',
    11: 'Linea',
    12: 'Codex',
    13: 'Sonic',
    14: 'World Chain',
    15: 'Monad',
    16: 'Sei',
    17: 'BNB Smart Chain', // USYC only, permanently excluded from USDC routes
    18: 'XDC',
    19: 'HyperEVM',
    21: 'Ink',
    22: 'Plume',
    25: 'Starknet',
    26: 'Arc', // 'Arc testnet' until mainnet launches
    27: 'Stellar',
    28: 'EDGE',
    29: 'Injective',
    30: 'Morph',
    31: 'Pharos',
    32: 'Cronos',
    33: 'Plasma',
    37: 'X Layer',
};

async function fetchText(url: string): Promise<string> {
    const res = await fetch(url, { headers: { 'User-Agent': 'stellarusdcto registry check' } });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return res.text();
}

function parseDomainTable(markdown: string): Map<number, string> {
    // The domain identifiers table renders as rows like "| 0 | Ethereum |",
    // possibly all on one line. Capture every | number | name | pair after
    // the "Domain identifiers" heading.
    const section = markdown.slice(markdown.indexOf('Domain identifiers'));
    const out = new Map<number, string>();
    for (const match of section.matchAll(/\|\s*(\d{1,3})\s*\|\s*([A-Za-z0-9 .()-]+?)\s*\|/g)) {
        out.set(Number(match[1]), match[2].trim());
    }
    return out;
}

const problems: string[] = [];

const supported = await fetchText(SUPPORTED_URL);
const circleDomains = parseDomainTable(supported);
if (circleDomains.size < 20) {
    problems.push(
        `Parsed only ${circleDomains.size} domains from the supported chains page, the format probably changed.`,
    );
}

for (const [domain, name] of circleDomains) {
    if (!(domain in TRIAGED_DOMAINS)) {
        problems.push(`NEW domain in Circle's table: ${domain} (${name}). Triage it.`);
    }
}
for (const [domainText, name] of Object.entries(TRIAGED_DOMAINS)) {
    const domain = Number(domainText);
    if (circleDomains.size >= 20 && !circleDomains.has(domain)) {
        problems.push(`Domain ${domain} (${name}) vanished from Circle's table.`);
    }
}

for (const registry of [TESTNET, MAINNET]) {
    for (const chain of registry.chains) {
        if (!circleDomains.has(chain.domain) && circleDomains.size >= 20) {
            problems.push(
                `Registry ${registry.env} chain ${chain.id} uses domain ${chain.domain}, which Circle no longer lists.`,
            );
        }
    }
}

const contracts = await fetchText(CONTRACTS_URL);
const mustAppear: Array<[string, string]> = [
    ['testnet TokenMessengerV2', '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'],
    ['testnet MessageTransmitterV2', '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'],
    ['mainnet TokenMessengerV2', '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'],
    ['mainnet MessageTransmitterV2', '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'],
];
for (const [label, address] of mustAppear) {
    if (!contracts.toLowerCase().includes(address.toLowerCase())) {
        problems.push(`${label} ${address} no longer appears on the contract addresses page.`);
    }
}

if (problems.length > 0) {
    console.error('Registry drift detected:\n');
    for (const p of problems) console.error(`  · ${p}`);
    process.exit(1);
}

console.log(
    `Registry matches Circle's docs: ${circleDomains.size} domains listed, ` +
        `${Object.keys(TRIAGED_DOMAINS).length} triaged, contract pairs unchanged.`,
);
