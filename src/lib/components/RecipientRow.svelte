<script lang="ts" module>
    import type { TransferError } from '$lib/errors/codes';

    export type RecipientStatus = {
        kind: 'empty' | 'invalid' | 'checking' | 'ok' | 'problem';
        problem: TransferError | null;
    };
</script>

<script lang="ts">
    import { getChainAdapter, getStellarAdapter } from '$lib/adapters';
    import { getChain } from '$lib/registry';
    import { shortAddr } from '$lib/utils';

    let {
        recipient = $bindable(''),
        status = $bindable<RecipientStatus>({ kind: 'empty', problem: null }),
        destId,
        autoAddress,
        amount6,
        disabled = false,
    }: {
        recipient?: string;
        status?: RecipientStatus;
        destId: string;
        autoAddress: string | null;
        amount6: bigint | null;
        disabled?: boolean;
    } = $props();

    let manual = $state(false);
    let inputEl = $state<HTMLInputElement | undefined>();

    // While not manually edited, the recipient follows the connected
    // destination wallet (including when it connects later or the chain flips).
    $effect(() => {
        if (!manual) recipient = autoAddress ?? '';
    });

    function edit() {
        manual = true;
        recipient = '';
        queueMicrotask(() => inputEl?.focus());
    }

    function useWallet() {
        manual = false;
        recipient = autoAddress ?? '';
    }

    // Live preflight, debounced. The check is per (destination, recipient,
    // amount); a token guards against out of order answers.
    let checkToken = 0;
    $effect(() => {
        const value = recipient.trim();
        const dest = destId;
        const amount = amount6 ?? 0n;
        const token = ++checkToken;

        if (value === '') {
            status = { kind: 'empty', problem: null };
            return;
        }
        const adapter = dest === 'stellar' ? getStellarAdapter() : getChainAdapter(getChain(dest));
        if (!adapter.validateRecipient(value)) {
            status = { kind: 'invalid', problem: null };
            return;
        }
        status = { kind: 'checking', problem: null };
        const timer = setTimeout(async () => {
            try {
                const problems = await adapter.checkDestination(value, amount);
                if (token !== checkToken) return;
                status = problems.length
                    ? { kind: 'problem', problem: problems[0] }
                    : { kind: 'ok', problem: null };
            } catch {
                if (token !== checkToken) return;
                // An unreachable check never blocks; the engine gate re runs it.
                status = { kind: 'ok', problem: null };
            }
        }, 450);
        return () => clearTimeout(timer);
    });

    let okCopy = $derived(
        destId === 'stellar' ? 'Recipient can receive USDC' : 'Address format checks out',
    );
    let isSelf = $derived(!manual && autoAddress !== null && recipient === autoAddress);
</script>

<div class="recipient" class:disabled>
    {#if manual || autoAddress === null}
        <div class="entry">
            <input
                bind:this={inputEl}
                class="input"
                type="text"
                placeholder={destId === 'stellar' ? 'G… Stellar address' : 'Recipient address'}
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                aria-label="Recipient address"
                aria-describedby="recipient-status"
                bind:value={recipient}
                oninput={() => (manual = true)}
                {disabled}
            />
            {#if autoAddress !== null}
                <button type="button" class="link" onclick={useWallet} {disabled}>
                    Use my wallet
                </button>
            {/if}
        </div>
    {:else}
        <div class="entry">
            <code class="self" title={recipient}>{shortAddr(recipient)}</code>
            {#if isSelf}<span class="you">(you)</span>{/if}
            <button
                type="button"
                class="link edit"
                onclick={edit}
                {disabled}
                aria-label="Send to a different address"
            >
                ✎ change
            </button>
        </div>
    {/if}

    <p id="recipient-status" class="status {status.kind}" role="status">
        {#if status.kind === 'checking'}
            Checking the recipient…
        {:else if status.kind === 'ok'}
            ✓ {okCopy}
        {:else if status.kind === 'invalid' && recipient.trim() !== ''}
            This does not look like a valid address for this chain.
        {:else if status.kind === 'problem' && status.problem}
            {status.problem.userMessage}
            <span class="fix">{status.problem.action}</span>
        {/if}
    </p>
</div>

<style>
    .recipient {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .entry {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        min-height: 44px;
        padding: 0.45rem 0.9rem;
        background: var(--bg-elev-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        transition: border-color 120ms;
    }

    .entry:focus-within {
        border-color: var(--accent);
    }

    .input {
        flex: 1;
        min-width: 0;
        background: none;
        border: none;
        outline: none;
        font-family: var(--mono);
        font-size: 0.88rem;
        color: var(--text);
        padding: 0;
    }

    .input::placeholder {
        color: var(--text-dim);
        font-family: var(--sans);
    }

    .self {
        font-size: 0.88rem;
        color: var(--text);
    }

    .you {
        color: var(--text-dim);
        font-size: 0.8rem;
    }

    .link {
        margin-left: auto;
        background: none;
        border: none;
        color: var(--accent);
        font-size: 0.8rem;
        padding: 0.2rem 0.3rem;
        border-radius: 6px;
        white-space: nowrap;
    }

    .link:hover:not(:disabled) {
        background: var(--accent-dim);
    }

    .status {
        margin: 0;
        min-height: 1.2rem;
        font-size: 0.8rem;
        color: var(--text-dim);
        line-height: 1.45;
    }

    .status.ok {
        color: var(--success);
    }

    .status.problem {
        color: var(--warning);
    }

    .status.invalid {
        color: var(--error);
    }

    .fix {
        display: block;
        color: var(--text-muted);
    }

    .disabled {
        opacity: 0.65;
    }
</style>
