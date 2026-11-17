// Can this build read the Stellar network as it is today?
//
// Stellar upgrades its protocol a few times a year, testnet about three weeks
// before mainnet, and an upgrade can change the binary formats the bundled
// SDK has to decode. A static site keeps shipping the SDK it was built with,
// so a format it cannot read breaks transfers until someone notices. Protocol
// 30 was noticed by a failed transfer. This script is the other way to
// notice: it runs the reads the app depends on against both networks, with
// the SDK version in the lockfile, and fails when one of them cannot be read.
// Because testnet upgrades first, a failure there is weeks of warning for
// mainnet.
//
// Run with: pnpm exec tsx scripts/check-stellar.ts [--testnet | --mainnet]

import { readFileSync } from 'node:fs';
import {
    Account,
    Address,
    BASE_FEE,
    Contract,
    TransactionBuilder,
    rpc,
    scValToNative,
} from '@stellar/stellar-sdk';
import { MAINNET, TESTNET } from '../src/lib/registry/index';
import type { Registry } from '../src/lib/registry/types';
import { latestLedgerSequence, stellarRpcCall, transactionStatus } from '../src/lib/stellar/client';

const inCi = Boolean(process.env.GITHUB_ACTIONS);
const warn = (text: string) => console.log(inCi ? `::warning::${text}` : `note: ${text}`);
const fail = (text: string) => console.log(inCi ? `::error::${text}` : `FAILED: ${text}`);
const reason = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 160);

/** A node that did not answer, as opposed to one whose answer could not be read. */
const unreachable = (e: unknown) =>
    /fetch failed|timed? ?out|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up|status code (429|5\d\d)|HTTP (429|5\d\d)/i.test(
        reason(e),
    );

type Outcome = { env: string; protocol: number | null; failures: string[] };

async function checkNetwork(registry: Registry): Promise<Outcome> {
    const { stellar, env } = registry;
    const outcome: Outcome = { env, protocol: null, failures: [] };

    // The app talks to the first node on the list. If that one is down, the
    // others still tell us whether the network itself can be read.
    let url = '';
    let latest: Record<string, unknown> | null = null;
    for (const candidate of stellar.rpcUrls) {
        try {
            latest = await stellarRpcCall('getLatestLedger', undefined, { url: candidate });
            url = candidate;
            break;
        } catch (e) {
            if (!unreachable(e)) throw e;
            warn(`Stellar ${env}: ${candidate} did not answer (${reason(e)})`);
        }
    }
    if (!latest) {
        outcome.failures.push('no node answered');
        fail(`Stellar ${env}: none of its ${stellar.rpcUrls.length} nodes answered`);
        return outcome;
    }
    if (url !== stellar.rpcUrls[0]) {
        warn(`Stellar ${env}: the node the app uses first is down; checked ${url} instead`);
    }

    outcome.protocol = Number(latest.protocolVersion);
    console.log(
        `\nStellar ${env}: protocol ${outcome.protocol}, ledger ${latest.sequence} (${url})`,
    );

    const server = new rpc.Server(url);
    const call = (method: string, params?: object) => stellarRpcCall(method, params, { url });
    const issuer = stellar.usdc.issuer;

    const reads: [string, () => Promise<unknown>][] = [
        ['ledger number, read as plain JSON', () => latestLedgerSequence(async () => latest)],
        ['ledger header and metadata, decoded by the bundled SDK', () => server.getLatestLedger()],
        ['account read', () => server.getAccount(issuer)],
        [
            'contract read (USDC balance)',
            async () => {
                const tx = new TransactionBuilder(new Account(issuer, '0'), {
                    fee: BASE_FEE,
                    networkPassphrase: stellar.networkPassphrase,
                })
                    .addOperation(
                        new Contract(stellar.contracts.usdc).call(
                            'balance',
                            Address.fromString(issuer).toScVal(),
                        ),
                    )
                    .setTimeout(30)
                    .build();
                const sim = await server.simulateTransaction(tx);
                if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
                if (!sim.result) throw new Error('simulation returned no value');
                scValToNative(sim.result.retval);
            },
        ],
        [
            'transaction read',
            async () => {
                // A transaction a few ledgers back, so the node has surely seen it.
                const page = (await (
                    await fetch(`${stellar.horizonUrl}/transactions?order=desc&limit=20`, {
                        signal: AbortSignal.timeout(20_000),
                    })
                ).json()) as { _embedded: { records: { hash: string }[] } };
                const hash = page._embedded.records.at(-1)?.hash;
                if (!hash) throw new Error('Horizon listed no transaction');
                const plain = await transactionStatus(hash, call);
                if (plain === 'NOT_FOUND') throw new Error(`the node does not know ${hash}`);
                await server.getTransaction(hash);
            },
        ],
    ];

    for (const [name, run] of reads) {
        try {
            await run();
            console.log(`  ok      ${name}`);
        } catch (e) {
            if (unreachable(e)) {
                // An outage is not a format problem. Say so, do not fail on it.
                warn(`Stellar ${env}: ${name}: the node did not answer (${reason(e)})`);
                continue;
            }
            outcome.failures.push(name);
            console.log(`  FAILED  ${name}: ${reason(e)}`);
        }
    }
    return outcome;
}

async function reportSdkVersions(): Promise<void> {
    const installed = JSON.parse(
        readFileSync(
            new URL('../node_modules/@stellar/stellar-sdk/package.json', import.meta.url),
            'utf8',
        ),
    ).version as string;
    try {
        const tags = (await (
            await fetch('https://registry.npmjs.org/-/package/@stellar/stellar-sdk/dist-tags', {
                signal: AbortSignal.timeout(15_000),
            })
        ).json()) as Record<string, string>;
        const line = `lts-${installed.split('.')[0]}`;
        console.log(
            `\nStellar SDK: ${installed} bundled, ${tags.latest} is the latest` +
                (tags[line] ? `, ${tags[line]} is the newest ${installed.split('.')[0]}.x` : ''),
        );
        if (tags[line] && tags[line] !== installed) {
            warn(
                `a newer Stellar SDK in the same line exists: ${tags[line]} (bundled ${installed})`,
            );
        }
    } catch (e) {
        console.log(
            `\nStellar SDK: ${installed} bundled (could not ask npm for newer ones: ${reason(e)})`,
        );
    }
}

const only = process.argv.includes('--testnet')
    ? [TESTNET]
    : process.argv.includes('--mainnet')
      ? [MAINNET]
      : [TESTNET, MAINNET];

const outcomes: Outcome[] = [];
for (const registry of only) outcomes.push(await checkNetwork(registry));
await reportSdkVersions();

const testnet = outcomes.find((o) => o.env === 'testnet');
const mainnet = outcomes.find((o) => o.env === 'mainnet');
if (testnet?.protocol && mainnet?.protocol && testnet.protocol > mainnet.protocol) {
    const gap = `testnet is on protocol ${testnet.protocol}, mainnet on ${mainnet.protocol}, so mainnet will follow`;
    if (testnet.failures.length) {
        fail(
            `${gap}, and this build cannot read protocol ${testnet.protocol} yet. Update @stellar/stellar-sdk before mainnet upgrades.`,
        );
    } else {
        warn(`${gap}. This build reads both.`);
    }
}

const broken = outcomes.filter((o) => o.failures.length);
for (const o of broken) fail(`Stellar ${o.env}: ${o.failures.join('; ')}`);
if (broken.length) {
    console.log('\nThis build cannot read Stellar as it is today. See the lines marked FAILED.');
    process.exit(1);
}
console.log('\nThis build reads Stellar as it is today.');
