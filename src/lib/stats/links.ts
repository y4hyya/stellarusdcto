import type { Registry } from '../registry/types';

/**
 * The explorer page for a transaction, built from the registry. Used by the
 * counting script when it writes its summary and by the stats page when it
 * renders a link: the page never follows an address that arrived in a file.
 * A chain the registry does not know has no link.
 */
export function explorerUrlFor(registry: Registry): (chain: string, tx: string) => string {
    const byId = new Map(registry.chains.map((c) => [c.id, c]));
    return (chain, tx) => {
        // Encoded, so whatever the id says the link stays on the explorer's
        // transaction path. Real ids are plain letters and digits and pass
        // through unchanged.
        const id = encodeURIComponent(tx);
        if (chain === 'stellar') return `${registry.stellar.explorer}/tx/${id}`;
        const entry = byId.get(chain);
        if (!entry) return '';
        if (entry.family === 'solana') return `${entry.explorer}/tx/${id}${entry.explorerSuffix}`;
        return `${entry.explorer}/tx/${id}`;
    };
}
