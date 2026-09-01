<script lang="ts">
    import { feeBpsFor, fetchBurnFee } from '$lib/circle/fees';
    import { getChain, stellarConfig, type TransferSpeed } from '$lib/registry';

    let {
        sourceId,
        destId,
        speed = $bindable<TransferSpeed>('standard'),
        fastAllowed,
        forwarding = $bindable(false),
        bundling,
        disabled = false,
    }: {
        sourceId: string;
        destId: string;
        speed?: TransferSpeed;
        fastAllowed: boolean;
        forwarding?: boolean;
        bundling: boolean;
        disabled?: boolean;
    } = $props();

    let sourceEntry = $derived(sourceId === 'stellar' ? null : getChain(sourceId));
    let destEntry = $derived(destId === 'stellar' ? null : getChain(destId));
    let srcDomain = $derived(sourceEntry?.domain ?? stellarConfig().domain);
    let dstDomain = $derived(destEntry?.domain ?? stellarConfig().domain);

    // Route keyed fee quote; amount independent, cached by the fees module.
    let feePromise = $derived(fetchBurnFee(srcDomain, dstDomain));
    let feeText = $derived.by(async () => {
        // Read reactive deps before the first await (they are untracked after).
        const currentSpeed = speed;
        const quote = feePromise;
        try {
            const bps = feeBpsFor(await quote, currentSpeed);
            return bps > 0 ? `${bps} bps (Fast)` : '$0';
        } catch {
            return currentSpeed === 'fast' ? 'quoted at send' : '$0';
        }
    });

    let etaText = $derived.by(() => {
        if (speed === 'fast') return '~20 s, then you claim';
        const eta = sourceEntry?.attestationEtaMs;
        if (eta === undefined || eta < 90_000) return '~1 min, then you claim';
        if (eta >= 90 * 60_000) return `~${Math.round(eta / 3_600_000)} h, then you claim`;
        return `~${Math.round(eta / 60_000)} min, then you claim`;
    });

    let gasNote = $derived.by(() => {
        if (forwarding && sourceId === 'stellar') return null;
        if (destEntry === null) return 'Claiming on Stellar needs a little XLM.';
        const token = destEntry.gasNote.replace('Gas paid in ', '').replace('.', '');
        return `Claiming on ${destEntry.label} needs a little ${token}.`;
    });

    function setSpeed(next: TransferSpeed) {
        speed = next;
    }

    function speedKeydown(event: KeyboardEvent) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            speed = speed === 'standard' ? 'fast' : 'standard';
        }
    }
</script>

<div class="summary">
    <div class="slip-row">
        <span>Arrives in</span>
        <span class="leader"></span>
        <span class="value"
            >{forwarding && sourceId === 'stellar' ? 'auto delivered' : etaText}</span
        >
    </div>
    <div class="slip-row">
        <span>Circle fee</span>
        <span class="leader"></span>
        {#await feeText}
            <span class="value">…</span>
        {:then text}
            <span class="value">{text}</span>
        {/await}
    </div>
    <div class="slip-row">
        <span>Our fee</span>
        <span class="leader"></span>
        <span class="value">none, ever</span>
    </div>

    {#if gasNote}
        <p class="note">ⓘ {gasNote}</p>
    {/if}
    {#if bundling}
        <p class="note">Your wallet bundles the approval and the burn into one confirmation.</p>
    {/if}

    {#if fastAllowed}
        <div class="speed" role="radiogroup" aria-label="Transfer speed">
            <button
                type="button"
                role="radio"
                aria-checked={speed === 'standard'}
                tabindex={speed === 'standard' ? 0 : -1}
                class="speed-option"
                class:active={speed === 'standard'}
                onclick={() => setSpeed('standard')}
                onkeydown={speedKeydown}
                {disabled}
            >
                Standard · free
            </button>
            <button
                type="button"
                role="radio"
                aria-checked={speed === 'fast'}
                tabindex={speed === 'fast' ? 0 : -1}
                class="speed-option"
                class:active={speed === 'fast'}
                onclick={() => setSpeed('fast')}
                onkeydown={speedKeydown}
                {disabled}
            >
                Fast · small fee
            </button>
        </div>
    {/if}

    {#if sourceId === 'stellar'}
        <div class="forwarding">
            <span class="forwarding-text">
                Auto delivery
                <span class="forwarding-sub">
                    Circle's relayer claims on the destination for you; its fee comes out of the
                    USDC. Experimental.
                </span>
            </span>
            <button
                type="button"
                class="switch"
                class:on={forwarding}
                {disabled}
                role="switch"
                aria-checked={forwarding}
                aria-label="Auto delivery through Circle's relayer"
                onclick={() => (forwarding = !forwarding)}
            >
                <span class="knob"></span>
            </button>
        </div>
    {/if}
</div>

<style>
    .summary {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        padding: 0.85rem 0.95rem;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius);
    }

    .note {
        margin: 0.1rem 0 0;
        font-size: 0.78rem;
        color: var(--text-dim);
        line-height: 1.45;
    }

    .speed {
        display: flex;
        gap: 0.4rem;
        margin-top: 0.35rem;
    }

    .speed-option {
        flex: 1;
        min-height: 40px;
        background: var(--bg-elev-2);
        color: var(--text-muted);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        font-size: 0.82rem;
        font-weight: 500;
        transition: all 120ms;
    }

    .speed-option:hover:not(:disabled) {
        border-color: var(--border-strong);
        color: var(--text);
    }

    .speed-option.active {
        background: var(--accent-dim);
        border-color: var(--accent);
        color: var(--text);
    }

    .forwarding {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        margin-top: 0.35rem;
        padding-top: 0.55rem;
        border-top: 1px dotted var(--border-strong);
    }

    .forwarding-text {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        font-size: 0.8rem;
        font-weight: 500;
    }

    .forwarding-sub {
        font-size: 0.72rem;
        font-weight: 400;
        color: var(--text-dim);
        line-height: 1.4;
    }

    .switch {
        flex: none;
        width: 2.5rem;
        height: 1.45rem;
        padding: 0.16rem;
        border-radius: 999px;
        background: var(--bg-elev-2);
        border: 1px solid var(--border-strong);
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        transition: all 120ms;
    }

    .switch.on {
        background: var(--accent-dim);
        border-color: var(--accent);
        justify-content: flex-end;
    }

    .switch:disabled {
        opacity: 0.5;
    }

    .knob {
        width: 1rem;
        height: 1rem;
        border-radius: 999px;
        background: var(--text-muted);
    }

    .switch.on .knob {
        background: var(--accent);
    }
</style>
