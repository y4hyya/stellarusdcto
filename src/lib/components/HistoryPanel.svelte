<script lang="ts">
    import { formatUsdc } from '$lib/amounts';
    import { resolve } from '$app/paths';
    import { getEnv } from '$lib/registry';
    import { clearJournal, listTransfers, type TransferRecord } from '$lib/journal/journal';

    let dialog = $state<HTMLDialogElement | undefined>();
    let records = $state<TransferRecord[]>([]);

    export function open() {
        records = listTransfers();
        dialog?.showModal();
    }

    function clearAll() {
        clearJournal();
        records = [];
    }

    function age(record: TransferRecord): string {
        const ms = Date.now() - record.createdAt;
        const minutes = Math.round(ms / 60_000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes} min ago`;
        const hours = Math.round(minutes / 60);
        if (hours < 48) return `${hours} h ago`;
        return `${Math.round(hours / 24)} d ago`;
    }

    function routeLabel(record: TransferRecord): string {
        return `${record.sourceId} → ${record.destId}`;
    }

    function phaseLabel(record: TransferRecord): string {
        if (record.phase === 'done') return 'completed';
        if (record.phase === 'error') return record.burnTxId ? 'needs finishing' : 'failed early';
        return record.phase;
    }
</script>

<dialog bind:this={dialog} class="panel" aria-label="Transfer history">
    <div class="head">
        <h2 class="title">History</h2>
        <button class="close" onclick={() => dialog?.close()} aria-label="Close">✕</button>
    </div>
    <p class="blurb">
        Kept only in this browser, never sent anywhere. Anything unfinished can be completed from
        its burn hash at any time.
    </p>
    {#if records.length === 0}
        <p class="empty">No transfers yet.</p>
    {:else}
        <ul class="list">
            {#each records as record (record.id)}
                <li class="row">
                    <div class="row-main">
                        <span class="route">{routeLabel(record)}</span>
                        <span class="amount">{formatUsdc(BigInt(record.amount6))} USDC</span>
                    </div>
                    <div class="row-sub">
                        {#if record.env !== getEnv()}
                            <span class="env-tag">{record.env}</span>
                        {/if}
                        <span class="phase {record.phase}">{phaseLabel(record)}</span>
                        <span class="when">{age(record)}</span>
                        {#if record.phase !== 'done' && record.burnTxId}
                            <!-- eslint-disable svelte/no-navigation-without-resolve -- the path IS resolve()d; the rule cannot see through the query string append -->
                            <a
                                class="resume"
                                href={`${resolve('/rescue')}?hash=${record.burnTxId}`}
                            >
                                Finish it
                            </a>
                            <!-- eslint-enable svelte/no-navigation-without-resolve -->
                        {/if}
                    </div>
                </li>
            {/each}
        </ul>
        <button class="clear" onclick={clearAll}>Clear history</button>
    {/if}
</dialog>

<style>
    .panel {
        width: min(26rem, calc(100vw - 2rem));
        max-height: min(34rem, 85vh);
        padding: 1rem 1.1rem;
        display: none;
        flex-direction: column;
        gap: 0.6rem;
    }

    .panel[open] {
        display: flex;
    }

    .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .title {
        margin: 0;
        font-size: 1rem;
    }

    .close {
        min-width: 36px;
        min-height: 36px;
        background: none;
        border: none;
        color: var(--text-dim);
        border-radius: var(--radius);
    }

    .close:hover {
        color: var(--text);
    }

    .blurb {
        margin: 0;
        font-size: 0.8rem;
        color: var(--text-dim);
        line-height: 1.45;
    }

    .empty {
        margin: 0.5rem 0 0;
        color: var(--text-dim);
        font-size: 0.85rem;
    }

    .list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        overflow-y: auto;
    }

    .row {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        padding: 0.55rem 0.7rem;
        background: var(--bg-elev-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
    }

    .row-main {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
    }

    .route {
        font-family: var(--mono);
        font-size: 0.82rem;
    }

    .amount {
        font-family: var(--mono);
        font-size: 0.82rem;
        font-variant-numeric: tabular-nums;
    }

    .row-sub {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        font-size: 0.75rem;
        color: var(--text-dim);
    }

    .env-tag {
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-size: 0.65rem;
        font-weight: 700;
        color: var(--warning);
        border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent);
        border-radius: 999px;
        padding: 0.05rem 0.4rem;
    }

    .phase.done {
        color: var(--success);
    }

    .phase.error {
        color: var(--warning);
    }

    .when {
        margin-left: auto;
    }

    .resume {
        font-weight: 600;
    }

    .clear {
        align-self: flex-start;
        background: none;
        border: none;
        color: var(--text-dim);
        font-size: 0.78rem;
        padding: 0.25rem 0.35rem;
        border-radius: 6px;
    }

    .clear:hover {
        color: var(--error);
        background: var(--error-dim);
    }
</style>
