// Counts the transfers that carry the public usage tag.
//
//   pnpm exec tsx scripts/stats/collect.ts --data <dir> [--only base,solana] [--budget-ms 240000]
//
// Reads every mainnet chain in the registry through public RPCs, keeps the
// burns (and Stellar mints) whose transaction carries the tag, and writes into
// <dir>:
//
//   transfers.jsonl   every counted burn, appended to on each run
//   mints.jsonl       every tagged mint on Stellar
//   checkpoints.json  where each chain was last read up to
//   stats.json        the totals the /stats page reads
//   README.md         the same totals for someone reading the files directly
//
// No keys, no server. Each chain gets the time budget; one that does not
// finish, or whose RPC fails, is picked up where it stopped on the next run
// and is marked as such in the coverage table. A run never loses what an
// earlier run found.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAINNET } from '../../src/lib/registry/index';
import type { EvmChainEntry, SolanaChainEntry } from '../../src/lib/registry/types';
import { parseStats } from '../../src/lib/stats/format';
import type {
    ChainCoverage,
    CoverageGap,
    MintRecord,
    Stats,
    TransferRecord,
} from '../../src/lib/stats/types';
import { buildStats } from './aggregate';
import { scanEvmChain } from './evm';
import { resolveNonces } from './iris';
import { COUNTING_SINCE, chainHelpers, parseArgs, summaryMarkdown } from './report';
import { describeError, fetchJson } from './rpc';
import { scanRpcUrls, scanSpan } from './rpcs';
import { scanSolana, type SolanaCheckpoint } from './solana';
import { scanStellar } from './stellar';
import { appendUnique, readJson, readJsonl, writeJson, writeJsonl } from './store';

type Checkpoints = {
    /** Last block scanned per EVM chain (a decimal string). */
    evm: Record<string, string | null>;
    /** Where the Solana scan stands, including an unfinished pass. */
    solana: SolanaCheckpoint;
    /** Last ledger scanned on Stellar. */
    stellar: number | null;
    /** The latest coverage row per chain, kept so a partial run does not blank the others. */
    coverage: Record<string, ChainCoverage>;
    /** Stretches that could not be read and never will be. Only ever added to. */
    gaps: CoverageGap[];
};

/** The chain scans and the nonce lookup, replaceable so a run can be tested offline. */
export type Scanners = {
    scanEvmChain: typeof scanEvmChain;
    scanSolana: typeof scanSolana;
    scanStellar: typeof scanStellar;
    resolveNonces: (records: TransferRecord[]) => Promise<TransferRecord[]>;
};

function loadCheckpoints(path: string): Checkpoints {
    const raw = readJson<Partial<Checkpoints> & { solana?: unknown }>(path, {});
    // Earlier files kept the Solana checkpoint as a bare signature.
    const solana =
        typeof raw.solana === 'object' && raw.solana !== null
            ? (raw.solana as SolanaCheckpoint)
            : { signature: typeof raw.solana === 'string' ? raw.solana : null };
    return {
        evm: raw.evm ?? {},
        solana,
        stellar: raw.stellar ?? null,
        coverage: raw.coverage ?? {},
        gaps: raw.gaps ?? [],
    };
}

export async function run(
    args: { data: string; only: string[] | null; budgetMs: number },
    replace: Partial<Scanners> = {},
): Promise<Stats> {
    mkdirSync(args.data, { recursive: true });
    const path = (name: string) => join(args.data, name);

    let transfers = readJsonl<TransferRecord>(path('transfers.jsonl'));
    let mints = readJsonl<MintRecord>(path('mints.jsonl'));
    const checkpoints = loadCheckpoints(path('checkpoints.json'));
    // State is written after every chain, so a run that is killed keeps what
    // the chains that finished had found.
    const save = () => {
        writeJsonl(path('transfers.jsonl'), transfers);
        writeJsonl(path('mints.jsonl'), mints);
        writeJson(path('checkpoints.json'), checkpoints);
    };

    const registry = MAINNET;
    const { familyOf, explorerUrl, destOf, domainOf, labels } = chainHelpers(registry);
    const since = new Date(`${COUNTING_SINCE}T00:00:00Z`);
    const report = (id: string, c: ChainCoverage, seen: number, found: number) =>
        console.log(
            `${id.padEnd(11)} ${c.status.padEnd(6)} examined ${String(seen).padStart(6)}  tagged ${String(found).padStart(4)}  ${c.note ?? ''}`,
        );

    const scanners: Scanners = {
        scanEvmChain,
        scanSolana,
        scanStellar,
        resolveNonces: (records) =>
            resolveNonces(records, { irisBase: registry.irisBase, domainOf, fetchJson }),
        ...replace,
    };
    // A chain's scan reports its own failures. This is for the ones it does
    // not see coming: whatever goes wrong inside one chain's job is recorded
    // against that chain and costs the others nothing.
    const guarded = async (id: string, job: () => Promise<void>) => {
        try {
            await job();
        } catch (err) {
            checkpoints.coverage[id] = {
                chain: id,
                status: 'error',
                through: null,
                note: describeError(err),
            };
            save();
            report(id, checkpoints.coverage[id], 0, 0);
        }
    };
    const deadline = Date.now() + args.budgetMs;
    const wanted = (id: string) => !args.only || args.only.includes(id);
    const jobs: Promise<void>[] = [];

    for (const entry of registry.chains.filter((c): c is EvmChainEntry => c.family === 'evm')) {
        if (!wanted(entry.id)) continue;
        jobs.push(
            guarded(entry.id, async () => {
                const last = checkpoints.evm[entry.id];
                const result = await scanners.scanEvmChain({
                    entry,
                    rpcUrls: scanRpcUrls(entry.id, entry.chain.rpcUrls.default.http),
                    fromBlock: last ? BigInt(last) : null,
                    since,
                    deadline,
                    initialSpan: scanSpan(entry.id),
                    destOf,
                });
                transfers = appendUnique(transfers, result.records);
                if (result.through !== null) checkpoints.evm[entry.id] = result.through.toString();
                checkpoints.coverage[entry.id] = result.coverage;
                save();
                report(entry.id, result.coverage, result.seen, result.records.length);
            }),
        );
    }

    const solana = registry.chains.find((c): c is SolanaChainEntry => c.family === 'solana');
    if (solana && wanted(solana.id)) {
        jobs.push(
            guarded(solana.id, async () => {
                const result = await scanners.scanSolana({
                    entry: solana,
                    rpcUrls: solana.rpcUrls,
                    state: checkpoints.solana,
                    since,
                    deadline,
                    destOf,
                });
                transfers = appendUnique(transfers, result.records);
                checkpoints.solana = result.state;
                checkpoints.coverage[solana.id] = result.coverage;
                save();
                report(solana.id, result.coverage, result.seen, result.records.length);
            }),
        );
    }

    if (wanted('stellar')) {
        jobs.push(
            guarded('stellar', async () => {
                // Where the last reading of Stellar ended, for the start of a hole.
                const readUntil = checkpoints.coverage.stellar?.through ?? since.toISOString();
                const result = await scanners.scanStellar({
                    contracts: registry.stellar.contracts,
                    rpcUrls: registry.stellar.rpcUrls,
                    fromLedger: checkpoints.stellar,
                    since,
                    deadline,
                    destOf,
                });
                transfers = appendUnique(transfers, result.transfers);
                mints = appendUnique(mints, result.mints);
                checkpoints.stellar = result.through;
                // A hole is recorded once and never removed: the node no
                // longer has that history, so no later run can fill it.
                const hole = result.gap;
                if (
                    hole &&
                    !checkpoints.gaps.some((g) => g.chain === 'stellar' && g.to === hole.to)
                ) {
                    checkpoints.gaps.push({ chain: 'stellar', from: readUntil, to: hole.to });
                }
                checkpoints.coverage.stellar = result.coverage;
                save();
                report(
                    'stellar',
                    result.coverage,
                    result.seen,
                    result.transfers.length + result.mints.length,
                );
            }),
        );
    }

    await Promise.all(jobs);

    // Burns that do not know their CCTP nonce yet ask Circle for it; the ones
    // Circle has not attested stay unresolved until a later run.
    transfers = await scanners.resolveNonces(transfers);
    save();

    const order = [...registry.chains.map((c) => c.id), 'stellar'];
    const coverage = order.map(
        (id): ChainCoverage =>
            checkpoints.coverage[id] ?? {
                chain: id,
                status: 'behind',
                through: null,
                note: 'not scanned yet',
            },
    );
    const stats = buildStats({
        transfers,
        mints,
        coverage,
        gaps: checkpoints.gaps,
        familyOf,
        explorerUrl,
        now: new Date(),
        since: COUNTING_SINCE,
    });
    // Never publish a file the page would refuse to draw.
    if (!parseStats(JSON.parse(JSON.stringify(stats)))) {
        throw new Error('the generated stats do not match the shape the page reads');
    }
    writeJson(path('stats.json'), stats);
    writeFileSync(path('README.md'), summaryMarkdown(stats, labels));

    const problems = coverage.filter((c) => c.status !== 'ok').length;
    console.log(
        `\n${stats.totals.transfers} transfers, ${stats.totals.volume} units of volume, ` +
            `${stats.totals.wallets} wallets, ${stats.totals.rescues} rescues. ` +
            `${coverage.length - problems} of ${coverage.length} chains up to date.`,
    );
    return stats;
}

// Only when run as a script, so the tests can import `run` without starting one.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    Promise.resolve()
        .then(() => run(parseArgs(process.argv.slice(2))))
        .catch((err) => {
            console.error(`usage stats run failed: ${describeError(err)}`);
            process.exit(1);
        });
}
