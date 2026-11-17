<script lang="ts">
    import { resolve } from '$app/paths';
    import { EVM_TAG_SUFFIX, STELLAR_TAG_MIN_TIME, TAG, tagEnabled } from '$lib/attribution/tag';
    import ContractArg from './ContractArg.svelte';

    // What a signing preview says about the public usage tag. The tag is part
    // of what gets signed, so a preview that left it out would not be showing
    // everything. It is listed last and worded as what it is: not an argument
    // of the call, and not something that can change where the funds go.
    // Rendered only where the tag is switched on.
    let { family }: { family: 'evm' | 'solana' | 'stellar' } = $props();

    const on = tagEnabled();
</script>

{#if on}
    {#if family === 'evm'}
        <ContractArg name="usage tag" type="28 bytes" value={EVM_TAG_SUFFIX} hex>
            {#snippet note()}
                Sent after the arguments above, not as one of them. Circle's contract ignores
                trailing bytes; these only mark the transfer as made here, so
                <a href={resolve('/stats')}>usage can be counted</a> from public chain data. They are
                added only when a simulation right before signing shows they change nothing.
            {/snippet}
        </ContractArg>
    {:else if family === 'solana'}
        <ContractArg name="usage tag" type="memo" value={TAG}>
            {#snippet note()}
                A memo instruction next to the burn, in the same transaction. It only marks the
                transfer as made here, so <a href={resolve('/stats')}>usage can be counted</a> from public
                chain data. It is left out if the transaction would not fit with it.
            {/snippet}
        </ContractArg>
    {:else}
        <ContractArg name="usage tag" type="valid after" value={String(STELLAR_TAG_MIN_TIME)}>
            {#snippet note()}
                The transaction's "valid after" time, set to a fixed moment in the past (10 July
                2025), which every ledger already satisfies. It only marks the transfer as made
                here, so <a href={resolve('/stats')}>usage can be counted</a> from public chain data.
                It is left out if the transaction does not simulate cleanly with it.
            {/snippet}
        </ContractArg>
    {/if}
{/if}
