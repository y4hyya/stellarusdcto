<script lang="ts">
    import { onMount } from 'svelte';
    import DailyChart from '$lib/components/stats/DailyChart.svelte';
    import { TAG } from '$lib/attribution/tag';
    import { MAINNET } from '$lib/registry';
    import { usdc } from '$lib/stats/chart';
    import { chainLabel, formatUsdc6, parseStats } from '$lib/stats/format';
    import { STATS_DATA_URL, STATS_SCRIPT_URL, STATS_URL } from '$lib/stats/source';
    import type { ChainCoverage, Stats } from '$lib/stats/types';

    // The numbers are mainnet numbers on both sites: the counting script only
    // reads mainnet. Labels therefore come from the mainnet registry whatever
    // environment this page is served in.
    const labels: Record<string, string> = { stellar: 'Stellar' };
    for (const chain of MAINNET.chains) labels[chain.id] = chain.label;
    const name = (id: string) => chainLabel(id, labels);

    type View =
        { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; stats: Stats };
    let view = $state<View>({ status: 'loading' });

    // The file comes from another origin, so it is only ever used through
    // parseStats: anything unexpected shows the unavailable state.
    async function load() {
        view = { status: 'loading' };
        try {
            const res = await fetch(STATS_URL, { cache: 'no-store' });
            const stats = res.ok ? parseStats(await res.json()) : null;
            view = stats ? { status: 'ready', stats } : { status: 'unavailable' };
        } catch {
            view = { status: 'unavailable' };
        }
    }
    onMount(load);

    const CHART_DAYS = 90;
    const ROUTES_SHOWN = 10;

    const count = (n: number) => n.toLocaleString('en');
    const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;
    const when = (iso: string) =>
        `${new Date(iso).toLocaleString('en', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'UTC',
        })} UTC`;
    const day = (iso: string) =>
        new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
        });
    const shortHash = (tx: string) => (tx.length > 14 ? `${tx.slice(0, 8)}…${tx.slice(-4)}` : tx);

    const STATUS: Record<ChainCoverage['status'], { mark: string; label: string }> = {
        ok: { mark: '✓', label: 'Up to date' },
        behind: { mark: '…', label: 'Catching up' },
        error: { mark: '!', label: 'Could not be read' },
    };
</script>

<svelte:head>
    <title>Usage · stellarusdcto</title>
    <meta
        name="description"
        content="How much this bridge is used, counted from public chain data. No cookies, no analytics."
    />
</svelte:head>

{#snippet chainRow(chain: ChainCoverage)}
    <li class="chain-row">
        <span class="chain-name">{name(chain.chain)}</span>
        <span class="status {chain.status}">
            <span class="mark" aria-hidden="true">{STATUS[chain.status].mark}</span>
            {STATUS[chain.status].label}
        </span>
        <span class="chain-through">
            {chain.through ? `read to ${when(chain.through)}` : 'not read yet'}
        </span>
    </li>
{/snippet}

<div class="page">
    <header class="hero">
        <h1 class="headline">Usage, counted in public.</h1>
        <p class="sub">
            Every transfer made here carries a small public tag. These numbers are the mainnet
            transactions that carry it, read back from the chains once a day. Nothing is collected
            from you.
        </p>
    </header>

    {#if view.status === 'loading'}
        <section class="card glass quiet" aria-live="polite">Loading the latest numbers…</section>
    {:else if view.status === 'unavailable'}
        <section class="card glass notice" aria-live="polite">
            <h2 class="card-title">The numbers could not be loaded.</h2>
            <p>
                They are published as a file once a day. It may not exist yet, or it could not be
                reached just now. Nothing about transfers depends on it.
            </p>
            <div class="actions">
                <button class="retry" onclick={load}>Try again</button>
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external absolute URL -->
                <a href={STATS_DATA_URL} target="_blank" rel="noreferrer">See the published data</a>
            </div>
        </section>
    {:else}
        {@const stats = view.stats}
        {@const t = stats.totals}
        {@const chart = stats.daily.slice(-CHART_DAYS)}
        {@const routes = stats.routes.slice(0, ROUTES_SHOWN)}
        {@const widest = Math.max(1, ...routes.map((r) => usdc(r.volume)))}
        {@const current = stats.coverage.filter((c) => c.status === 'ok').length}
        {@const lagging = stats.coverage.filter((c) => c.status !== 'ok')}

        <section class="kpis" aria-label="Totals">
            <div class="kpi glass">
                <span class="kpi-label">Transfers</span>
                <span class="kpi-value">{count(t.transfers)}</span>
                <span class="kpi-note">started here</span>
            </div>
            <div class="kpi glass">
                <span class="kpi-label">Volume</span>
                <span class="kpi-value" title="{formatUsdc6(t.volume)} USDC">
                    {formatUsdc6(t.volume, { compact: true })}
                </span>
                <span class="kpi-note">USDC</span>
            </div>
            <div class="kpi glass">
                <span class="kpi-label">Wallets</span>
                <span class="kpi-value">{count(t.wallets)}</span>
                <span class="kpi-note">
                    {t.walletsByFamily.evm} EVM · {t.walletsByFamily.solana} Solana · {t
                        .walletsByFamily.stellar} Stellar
                </span>
            </div>
            <div class="kpi glass">
                <span class="kpi-label">Rescues</span>
                <span class="kpi-value">{count(t.rescues)}</span>
                <span class="kpi-note">
                    {formatUsdc6(t.rescuedVolume, { compact: true })} USDC finished here
                </span>
            </div>
        </section>

        {#if t.transfers === 0}
            <section class="card glass notice">
                <h2 class="card-title">Nothing counted yet.</h2>
                <p>
                    Counting starts with the first mainnet transfer that carries the tag. Transfers
                    made before {day(stats.since)} carry no tag and cannot be counted afterwards.
                </p>
            </section>
        {:else}
            <section class="card glass">
                <DailyChart daily={chart} />
            </section>

            <section class="card glass">
                <h2 class="card-title">Routes</h2>
                <ul class="routes">
                    {#each routes as route (`${route.source}>${route.dest}`)}
                        <li class="route">
                            <span class="route-name">
                                {name(route.source)}
                                <span class="arrow" aria-hidden="true">→</span>
                                <span class="sr-only">to</span>
                                {name(route.dest)}
                            </span>
                            <span class="route-figure">
                                {formatUsdc6(route.volume)}
                                <span class="unit">USDC</span>
                                <span class="route-count">
                                    {plural(route.transfers, 'transfer', 'transfers')}
                                </span>
                            </span>
                            <span class="route-bar" aria-hidden="true">
                                <span
                                    class="route-fill"
                                    style:width="{Math.max(
                                        1,
                                        (usdc(route.volume) / widest) * 100,
                                    )}%"
                                ></span>
                            </span>
                        </li>
                    {/each}
                </ul>
                {#if stats.routes.length > routes.length}
                    <p class="more">
                        And {plural(
                            stats.routes.length - routes.length,
                            'more route',
                            'more routes',
                        )} in the published data.
                    </p>
                {/if}
            </section>

            <section class="card glass">
                <h2 class="card-title">Latest transfers</h2>
                <ul class="recent">
                    {#each stats.recent as row (row.tx + row.time)}
                        <li class="recent-row">
                            <span class="recent-route">
                                {name(row.source)}
                                <span class="arrow" aria-hidden="true">→</span>
                                <span class="sr-only">to</span>
                                {name(row.dest)}
                            </span>
                            <span class="recent-amount">
                                {formatUsdc6(row.amount)} <span class="unit">USDC</span>
                            </span>
                            <span class="recent-meta">
                                <time datetime={row.time}>{when(row.time)}</time>
                                {#if row.url}
                                    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external explorer link, validated as https by parseStats -->
                                    <a
                                        href={row.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={row.tx}
                                    >
                                        {shortHash(row.tx)} ↗
                                    </a>
                                {:else}
                                    <code title={row.tx}>{shortHash(row.tx)}</code>
                                {/if}
                            </span>
                        </li>
                    {/each}
                </ul>
            </section>
        {/if}

        <section class="card glass">
            <h2 class="card-title">Coverage</h2>
            <p class="coverage-summary">
                <span class="status {lagging.length === 0 ? 'ok' : 'behind'}">
                    <span class="mark" aria-hidden="true">{lagging.length === 0 ? '✓' : '…'}</span>
                    {current} of {stats.coverage.length} chains read up to date
                </span>
            </p>
            {#if lagging.length > 0}
                <p class="coverage-note">
                    Transfers on these chains are missing from the totals until a later run catches
                    them up.
                </p>
                <ul class="chain-list">
                    {#each lagging as chain (chain.chain)}
                        {@render chainRow(chain)}
                    {/each}
                </ul>
            {/if}
            <details class="chains">
                <summary>
                    {lagging.length > 0
                        ? `Show the ${current} that are up to date`
                        : 'Show every chain'}
                </summary>
                <ul class="chain-list">
                    {#each stats.coverage.filter((c) => c.status === 'ok') as chain (chain.chain)}
                        {@render chainRow(chain)}
                    {/each}
                </ul>
            </details>
        </section>

        <section class="card glass how">
            <h2 class="card-title">How this is counted</h2>
            <p>
                A transfer made here looks like any other CCTP transfer on chain, so each one
                carries a public tag, <code>{TAG}</code>, that marks it. On EVM chains it is 28
                bytes after the call data, which Circle's contracts ignore. On Solana it is a memo
                next to the burn. On Stellar it is the transaction's "valid after" time, set to a
                fixed moment in the past.
            </p>
            <p>
                Once a day a script reads public RPCs for every chain, keeps the transactions that
                carry the tag, and publishes the totals shown here together with the full list of
                counted transactions. It uses no keys, so anyone can run it and check any transfer
                on an explorer.
            </p>
            <ul class="limits">
                <li>Counting started on {day(stats.since)}. Earlier transfers carry no tag.</li>
                <li>
                    Wallets are distinct signing addresses. One person with wallets on two kinds of
                    chain counts twice.
                </li>
                <li>
                    A rescue is a transfer finished here that was started somewhere else. Rescues
                    are counted for transfers into Stellar.
                </li>
                <li>
                    Anyone can copy the tag, so these are transactions that carry it, not a proof of
                    where they were signed.
                </li>
                <li>
                    This page reads one public file from GitHub. The transfer page talks only to
                    chain RPCs and to Circle.
                </li>
            </ul>
            <p class="links">
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external absolute URL -->
                <a href={STATS_SCRIPT_URL} target="_blank" rel="noreferrer">The script</a>
                ·
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external absolute URL -->
                <a href={STATS_DATA_URL} target="_blank" rel="noreferrer">The data</a>
            </p>
        </section>

        <p class="asof">
            As of <time datetime={stats.generatedAt}>{when(stats.generatedAt)}</time> · mainnet only
        </p>
    {/if}
</div>

<style>
    .page {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .hero {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        text-align: center;
        padding: 0.5rem 0 0.75rem;
    }

    .headline {
        margin: 0;
        font-size: clamp(1.6rem, 4vw, 2.1rem);
        font-weight: 650;
        letter-spacing: -0.02em;
        color: var(--wall-text);
        text-shadow: var(--wall-shadow);
    }

    .sub {
        margin: 0 auto;
        max-width: 33rem;
        color: var(--wall-text-dim);
        text-shadow: var(--wall-shadow);
        font-size: 0.93rem;
        line-height: 1.55;
    }

    .card {
        display: flex;
        flex-direction: column;
        gap: 0.7rem;
        padding: 1.15rem 1.25rem;
        border-radius: var(--radius-lg);
    }

    .card-title {
        margin: 0;
        font-size: 0.98rem;
        font-weight: 650;
        letter-spacing: -0.01em;
    }

    .card p {
        margin: 0;
        font-size: 0.86rem;
        line-height: 1.6;
        color: var(--text-muted);
    }

    .quiet {
        align-items: center;
        color: var(--text-dim);
        font-size: 0.88rem;
        padding: 2rem 1.25rem;
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.9rem;
        font-size: 0.86rem;
    }

    .retry {
        min-height: 40px;
        padding: 0 1rem;
        background: var(--accent-strong);
        color: var(--accent-contrast);
        border: none;
        border-radius: var(--radius);
        font-weight: 600;
    }

    .retry:hover {
        background: var(--accent-hover);
    }

    /* Totals: four figures in a row, two by two on a narrow screen. */
    .kpis {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.75rem;
    }

    .kpi {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        min-width: 0;
        padding: 0.95rem 1rem;
        border-radius: var(--radius-lg);
    }

    .kpi-label {
        font-size: 0.7rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-dim);
    }

    .kpi-value {
        font-size: 1.75rem;
        font-weight: 650;
        letter-spacing: -0.03em;
        line-height: 1.15;
        color: var(--text);
        overflow-wrap: anywhere;
    }

    .kpi-note {
        font-size: 0.74rem;
        line-height: 1.35;
        color: var(--text-dim);
    }

    .arrow {
        color: var(--text-dim);
        padding: 0 0.15rem;
    }

    .unit {
        color: var(--text-dim);
        font-size: 0.9em;
    }

    /* Routes: one row per route, largest first, bars on a shared baseline. */
    .routes,
    .recent,
    .chain-list,
    .limits {
        list-style: none;
        margin: 0;
        padding: 0;
    }

    .routes {
        display: flex;
        flex-direction: column;
        gap: 0.7rem;
    }

    .route {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 0.3rem 0.75rem;
        align-items: baseline;
        font-size: 0.86rem;
    }

    .route-name {
        font-weight: 500;
        min-width: 0;
    }

    .route-figure {
        font-family: var(--mono);
        font-size: 0.8rem;
        font-variant-numeric: tabular-nums;
        text-align: right;
        white-space: nowrap;
    }

    .route-count {
        margin-left: 0.5rem;
        color: var(--text-dim);
    }

    .route-bar {
        grid-column: 1 / -1;
        display: block;
        height: 8px;
    }

    .route-fill {
        display: block;
        height: 100%;
        min-width: 4px;
        border-radius: 0 4px 4px 0;
        background: #2775ca;
    }

    .more {
        color: var(--text-dim) !important;
        font-size: 0.78rem !important;
    }

    .recent {
        display: flex;
        flex-direction: column;
    }

    .recent-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 0.1rem 0.75rem;
        padding: 0.55rem 0;
        border-bottom: 1px solid var(--border);
        font-size: 0.86rem;
    }

    .recent-row:first-child {
        padding-top: 0;
    }

    .recent-row:last-child {
        border-bottom: none;
        padding-bottom: 0;
    }

    .recent-route {
        font-weight: 500;
    }

    .recent-amount {
        font-family: var(--mono);
        font-size: 0.8rem;
        font-variant-numeric: tabular-nums;
        text-align: right;
        white-space: nowrap;
    }

    .recent-meta {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.2rem 0.75rem;
        font-size: 0.76rem;
        color: var(--text-dim);
    }

    .recent-meta a,
    .recent-meta code {
        font-family: var(--mono);
    }

    /* Status never rides on colour alone: a mark and a word go with it. */
    .status {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.8rem;
        color: var(--text-muted);
    }

    .mark {
        display: inline-grid;
        place-items: center;
        width: 1.15rem;
        height: 1.15rem;
        border-radius: 50%;
        font-size: 0.7rem;
        font-weight: 700;
        line-height: 1;
    }

    .status.ok .mark {
        color: var(--success);
        background: var(--success-dim);
    }

    .status.behind .mark {
        color: var(--warning);
        background: var(--warning-dim);
    }

    .status.error .mark {
        color: var(--error);
        background: var(--error-dim);
    }

    .coverage-summary .status {
        font-size: 0.88rem;
        color: var(--text);
    }

    .coverage-note {
        font-size: 0.8rem !important;
    }

    .chains summary {
        cursor: pointer;
        width: fit-content;
        font-size: 0.8rem;
        color: var(--accent);
        padding: 0.2rem 0;
    }

    .chain-list {
        display: flex;
        flex-direction: column;
    }

    .chains .chain-list {
        margin-top: 0.4rem;
    }

    .chain-row {
        display: grid;
        grid-template-columns: 7.5rem 9.5rem minmax(0, 1fr);
        gap: 0.2rem 0.75rem;
        align-items: center;
        padding: 0.35rem 0;
        border-bottom: 1px solid var(--border);
        font-size: 0.8rem;
    }

    .chain-row:last-child {
        border-bottom: none;
    }

    .chain-name {
        font-weight: 500;
    }

    .chain-through {
        color: var(--text-dim);
        font-size: 0.76rem;
        text-align: right;
    }

    .how code {
        color: var(--text);
    }

    .limits {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        font-size: 0.82rem;
        line-height: 1.55;
        color: var(--text-muted);
    }

    .limits li {
        padding-left: 0.9rem;
        position: relative;
    }

    .limits li::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0.62em;
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--text-dim);
    }

    .links {
        font-size: 0.84rem !important;
    }

    .asof {
        margin: 0.25rem 0 0;
        text-align: center;
        font-size: 0.78rem;
        color: var(--wall-text-dim);
        text-shadow: var(--wall-shadow);
    }

    @media (max-width: 640px) {
        .kpis {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .chain-row {
            grid-template-columns: minmax(0, 1fr) auto;
        }

        .chain-through {
            grid-column: 1 / -1;
            text-align: left;
        }
    }

    @media (max-width: 420px) {
        .route,
        .recent-row {
            grid-template-columns: minmax(0, 1fr);
        }

        .route-figure,
        .recent-amount {
            text-align: left;
        }
    }
</style>
