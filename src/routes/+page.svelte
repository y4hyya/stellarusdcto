<script lang="ts">
    import { onMount } from 'svelte';
    import TransferCard from '$lib/components/TransferCard.svelte';
    import { unfinishedTransfers, type TransferRecord } from '$lib/journal/journal';
    import { shortAddr } from '$lib/utils';
    import { resolve } from '$app/paths';

    let unfinished = $state<TransferRecord[]>([]);

    onMount(() => {
        unfinished = unfinishedTransfers();
    });

    function refreshUnfinished() {
        unfinished = unfinishedTransfers();
    }
</script>

<svelte:head>
    <title>stellarusdcto · move USDC between Stellar and every CCTP chain</title>
</svelte:head>

<div class="page">
    <header class="hero">
        <h1 class="headline">Move USDC to and from Stellar.</h1>
        <p class="sub">
            Native USDC over Circle's CCTP. No pools, no wrapped tokens, no fees from us, and every
            transfer can always be finished, even after a closed tab.
        </p>
    </header>

    {#if unfinished.length > 0}
        <aside class="unfinished" aria-label="Unfinished transfers">
            <strong>
                {unfinished.length === 1 ? 'A transfer' : `${unfinished.length} transfers`} waiting to
                be finished.
            </strong>
            <span class="unfinished-sub">
                The burn happened, the mint has not landed yet. Nothing is lost.
            </span>
            {#each unfinished.slice(0, 3) as record (record.id)}
                <!-- eslint-disable svelte/no-navigation-without-resolve -- the path IS resolve()d; the rule cannot see through the query string append -->
                <a
                    class="unfinished-row"
                    href={`${resolve('/rescue')}?hash=${record.burnTxId ?? record.id}`}
                >
                    <code>{shortAddr(record.burnTxId ?? record.id)}</code>
                    <span>{record.sourceId} → {record.destId}</span>
                    <span class="go">Finish it →</span>
                </a>
                <!-- eslint-enable svelte/no-navigation-without-resolve -->
            {/each}
        </aside>
    {/if}

    <TransferCard onSettled={refreshUnfinished} />
</div>

<style>
    .page {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .hero {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        text-align: center;
        margin-bottom: 0.25rem;
    }

    .headline {
        margin: 0;
        font-size: 1.7rem;
        font-weight: 650;
        letter-spacing: -0.02em;
    }

    .sub {
        margin: 0 auto;
        max-width: 30rem;
        color: var(--text-muted);
        font-size: 0.92rem;
        line-height: 1.55;
    }

    .unfinished {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-width: 30rem;
        width: 100%;
        margin: 0 auto;
        padding: 0.85rem 1rem;
        background: var(--warning-dim);
        border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
        border-radius: var(--radius-lg);
        font-size: 0.88rem;
    }

    .unfinished strong {
        color: var(--warning);
    }

    .unfinished-sub {
        color: var(--text-muted);
        font-size: 0.82rem;
    }

    .unfinished-row {
        display: flex;
        align-items: center;
        gap: 0.7rem;
        padding: 0.5rem 0.7rem;
        background: var(--bg-elev);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        color: var(--text);
        font-size: 0.82rem;
    }

    .unfinished-row:hover {
        border-color: var(--accent);
        text-decoration: none;
    }

    .unfinished-row code {
        color: var(--text-muted);
    }

    .go {
        margin-left: auto;
        color: var(--accent);
        font-weight: 600;
        white-space: nowrap;
    }
</style>
