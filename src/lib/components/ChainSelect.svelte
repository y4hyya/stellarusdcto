<script lang="ts">
    import { listChains } from '$lib/registry';
    import type { ChainEntry } from '$lib/registry';

    let {
        value,
        onSelect,
        disabled = false,
    }: {
        value: string;
        onSelect: (id: string) => void;
        disabled?: boolean;
    } = $props();

    let dialog = $state<HTMLDialogElement | undefined>();
    let query = $state('');

    let selected = $derived(listChains().find((c) => c.id === value));
    let filtered = $derived(
        listChains().filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase())),
    );

    function open() {
        query = '';
        dialog?.showModal();
    }

    function pick(entry: ChainEntry) {
        dialog?.close();
        if (entry.id !== value) onSelect(entry.id);
    }
</script>

<button type="button" class="trigger" onclick={open} {disabled} aria-haspopup="dialog">
    <span class="dot" style:--chain-accent={selected?.accent ?? 'var(--accent)'}></span>
    <span class="label">{selected?.label ?? value}</span>
    <span class="caret" aria-hidden="true">▾</span>
</button>

<dialog bind:this={dialog} class="picker" closedby="any" aria-label="Choose a chain">
    <div class="picker-head">
        <input
            class="search"
            type="search"
            placeholder="Search chains"
            bind:value={query}
            aria-label="Search chains"
        />
        <button type="button" class="close" onclick={() => dialog?.close()} aria-label="Close">
            ✕
        </button>
    </div>
    <ul class="list">
        {#each filtered as entry (entry.id)}
            <li>
                <button
                    type="button"
                    class="option"
                    class:current={entry.id === value}
                    onclick={() => pick(entry)}
                >
                    <span class="dot big" style:--chain-accent={entry.accent}></span>
                    <span class="option-label">{entry.label}</span>
                    <span class="option-meta">domain {entry.domain}</span>
                </button>
            </li>
        {:else}
            <li class="empty">No chain matches "{query}"</li>
        {/each}
    </ul>
    <p class="foot">More chains land as the registry grows. All of CCTP V2 is on the way.</p>
</dialog>

<style>
    .trigger {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        min-height: 44px;
        padding: 0.45rem 0.75rem;
        background: var(--bg-elev-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        font-weight: 500;
        transition: border-color 120ms;
    }

    .trigger:hover:not(:disabled) {
        border-color: var(--border-strong);
    }

    .trigger:disabled {
        opacity: 0.55;
    }

    .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--chain-accent);
        flex: none;
    }

    .dot.big {
        width: 14px;
        height: 14px;
    }

    .caret {
        color: var(--text-dim);
        font-size: 0.75rem;
    }

    .picker {
        width: min(24rem, calc(100vw - 2rem));
        max-height: min(30rem, 80vh);
    }

    .picker-head {
        display: flex;
        gap: 0.5rem;
        padding: 0.85rem;
        border-bottom: 1px solid var(--border);
    }

    .search {
        flex: 1;
        min-height: 44px;
        padding: 0.4rem 0.75rem;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius);
    }

    .close {
        min-width: 44px;
        background: none;
        border: none;
        color: var(--text-dim);
        border-radius: var(--radius);
    }

    .close:hover {
        color: var(--text);
    }

    .list {
        list-style: none;
        margin: 0;
        padding: 0.5rem;
        overflow-y: auto;
        max-height: 20rem;
    }

    .option {
        display: flex;
        align-items: center;
        gap: 0.7rem;
        width: 100%;
        min-height: 48px;
        padding: 0.55rem 0.7rem;
        background: none;
        border: none;
        border-radius: var(--radius);
        text-align: left;
    }

    .option:hover {
        background: var(--bg-elev-2);
    }

    .option.current {
        background: var(--accent-dim);
    }

    .option-label {
        font-weight: 500;
    }

    .option-meta {
        margin-left: auto;
        color: var(--text-dim);
        font-family: var(--mono);
        font-size: 0.75rem;
    }

    .empty {
        padding: 1rem 0.7rem;
        color: var(--text-dim);
        font-size: 0.85rem;
    }

    .foot {
        margin: 0;
        padding: 0.65rem 0.85rem;
        border-top: 1px solid var(--border);
        color: var(--text-dim);
        font-size: 0.75rem;
    }

    @media (max-width: 560px) {
        .picker {
            width: 100vw;
            max-width: 100vw;
            margin: auto 0 0;
            border-radius: var(--radius-lg) var(--radius-lg) 0 0;
            border-bottom: none;
        }
    }
</style>
