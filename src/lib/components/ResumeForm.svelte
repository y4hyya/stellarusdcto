<script lang="ts">
    import { classifyHash } from '$lib/engine/core';

    let {
        disabled,
        onResume,
    }: {
        disabled: boolean;
        onResume: (burnHash: string) => void;
    } = $props();

    let burnHash = $state('');
    let trimmed = $derived(burnHash.trim());
    let classified = $derived(trimmed === '' ? null : classifyHash(trimmed));
    let formatError = $derived(
        trimmed !== '' && classified === null
            ? 'That does not look like a transaction hash from a supported chain.'
            : null,
    );
    let canResume = $derived(classified !== null && !disabled);

    function submit() {
        if (!canResume) return;
        onResume(trimmed);
    }
</script>

<details class="resume">
    <summary>Resume a transfer by burn hash</summary>
    <div class="body">
        <p class="blurb">
            Paste the burn transaction hash of any interrupted CCTP transfer, from this site or any
            other tool, and it gets picked back up at the attestation and completed. The source
            chain is detected from the hash automatically, and minting is permissionless, so only
            the receiving side's wallet needs to be connected.
        </p>
        <label class="hash-row">
            <span class="label">Burn hash</span>
            <input
                class="input"
                type="text"
                spellcheck="false"
                autocapitalize="off"
                autocorrect="off"
                autocomplete="off"
                placeholder="0x…, 64 hex chars, or a base58 signature"
                bind:value={burnHash}
                {disabled}
            />
        </label>
        {#if formatError}
            <p class="format-error">{formatError}</p>
        {/if}
        <button type="button" class="submit" disabled={!canResume} onclick={submit}>
            Resume
        </button>
    </div>
</details>

<style>
    .resume {
        background: var(--bg-elev-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        font-size: 0.9rem;
    }

    .resume > summary {
        padding: 0.6rem 0.85rem;
        cursor: pointer;
        color: var(--text-muted);
        list-style: revert;
    }

    .resume[open] > summary {
        color: var(--text);
        border-bottom: 1px solid var(--border);
    }

    .body {
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
        padding: 0.85rem;
    }

    .blurb {
        margin: 0;
        color: var(--text-muted);
        font-size: 0.85rem;
        line-height: 1.4;
    }

    .hash-row {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 0.6rem;
        background: var(--bg-elev);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 0.6rem 0.85rem;
    }

    .hash-row:focus-within {
        border-color: var(--accent);
    }

    .label {
        color: var(--text-dim);
        font-size: 0.8rem;
    }

    .input {
        background: none;
        border: none;
        color: var(--text);
        font-family: var(--mono);
        font-size: 0.85rem;
        outline: none;
        min-width: 0;
        width: 100%;
    }

    .input:disabled {
        color: var(--text-dim);
    }

    .format-error {
        margin: 0;
        color: var(--error);
        font-size: 0.8rem;
    }

    .submit {
        background: var(--accent);
        color: #0b0d12;
        border: none;
        padding: 0.6rem;
        border-radius: var(--radius);
        font-weight: 600;
        font-size: 0.9rem;
        transition: background 120ms;
    }

    .submit:hover:not(:disabled) {
        background: var(--accent-hover);
    }

    .submit:disabled {
        background: var(--bg-elev);
        color: var(--text-dim);
    }
</style>
