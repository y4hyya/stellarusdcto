<script lang="ts">
    import { formatUsdc } from '$lib/amounts';

    let {
        amount = $bindable(''),
        balance6,
        maxReserve6 = 0n,
        disabled = false,
    }: {
        amount?: string;
        balance6: bigint | null;
        /** Held back from Max on chains whose gas token is USDC. */
        maxReserve6?: bigint;
        disabled?: boolean;
    } = $props();

    function useMax() {
        if (balance6 === null) return;
        const spendable = balance6 - maxReserve6;
        amount = formatUsdc(spendable > 0n ? spendable : 0n);
    }
</script>

<div class="amount-box" class:disabled>
    <div class="row">
        <input
            class="amount"
            type="text"
            inputmode="decimal"
            placeholder="0.00"
            autocomplete="off"
            spellcheck="false"
            aria-label="Amount in USDC"
            bind:value={amount}
            {disabled}
        />
        <span class="unit">USDC</span>
    </div>
    <div class="meta">
        <span class="balance">
            {balance6 === null ? 'Balance —' : `Balance ${formatUsdc(balance6)}`}
        </span>
        {#if balance6 !== null && balance6 > 0n}
            <button type="button" class="max" onclick={useMax} {disabled}>Max</button>
        {/if}
    </div>
</div>

<style>
    .amount-box {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        padding: 0.7rem 0.9rem;
        background: var(--bg-elev-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        transition: border-color 120ms;
    }

    .amount-box:focus-within {
        border-color: var(--accent);
    }

    .row {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
    }

    .amount {
        flex: 1;
        min-width: 0;
        background: none;
        border: none;
        outline: none;
        font-family: var(--mono);
        font-size: 1.5rem;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: var(--text);
        padding: 0;
    }

    .amount::placeholder {
        color: var(--text-dim);
    }

    .unit {
        color: var(--text-muted);
        font-size: 0.9rem;
        font-weight: 500;
    }

    .meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        min-height: 1.4rem;
    }

    .balance {
        color: var(--text-dim);
        font-size: 0.78rem;
        font-variant-numeric: tabular-nums;
    }

    .max {
        background: none;
        border: none;
        color: var(--accent);
        font-size: 0.78rem;
        font-weight: 600;
        padding: 0.2rem 0.35rem;
        border-radius: 6px;
    }

    .max:hover:not(:disabled) {
        background: var(--accent-dim);
    }

    .disabled {
        opacity: 0.65;
    }
</style>
