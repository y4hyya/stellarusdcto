import type { ChainEntry, Registry, VmFamily } from '../registry/types';

// Pure engine helpers: step building for any route and the hash
// classification behind resume by hash. No network, fully unit tested.

export type FlowKind = 'direct' | 'sendCalls' | 'forwarded';

export type StepStatus = 'pending' | 'active' | 'done' | 'error';

export type Step = {
    key: 'approve' | 'burn' | 'attest' | 'mint';
    label: string;
    status: StepStatus;
    hash?: string;
    hashUrl?: string;
    detail?: string;
    startedAt?: number;
    endedAt?: number;
};

/** One side of a route: the literal 'stellar', or a counterparty chain entry. */
export type RouteSide = 'stellar' | ChainEntry;

export function sideFamily(side: RouteSide): VmFamily {
    return side === 'stellar' ? 'stellar' : side.family;
}

export function sideLabel(side: RouteSide): string {
    return side === 'stellar' ? 'Stellar' : side.label;
}

export function needsApprove(sourceFamily: VmFamily, flow: FlowKind): boolean {
    // Solana burns under the owner's signature, no allowance involved. An EVM
    // sendCalls burn folds the approve into the wallet batch. Everything else
    // approves the token messenger first.
    if (sourceFamily === 'solana') return false;
    if (sourceFamily === 'evm' && flow === 'sendCalls') return false;
    return true;
}

export function buildSteps(source: RouteSide, dest: RouteSide, flow: FlowKind): Step[] {
    const sourceName = sideLabel(source);
    const destName = sideLabel(dest);
    const steps: Step[] = [];

    if (needsApprove(sideFamily(source), flow)) {
        steps.push({
            key: 'approve',
            label: `Approve USDC on ${sourceName}`,
            status: 'pending',
        });
    }

    const burnLabel =
        flow === 'sendCalls'
            ? `Approve + burn USDC on ${sourceName} (batched by wallet)`
            : flow === 'forwarded'
              ? `Burn USDC on ${sourceName} (forwarding hook)`
              : `Burn USDC on ${sourceName}`;
    steps.push({ key: 'burn', label: burnLabel, status: 'pending' });
    steps.push({ key: 'attest', label: 'Wait for Circle attestation', status: 'pending' });

    const mintLabel =
        flow === 'forwarded'
            ? `Await Circle relayer mint on ${destName}`
            : dest === 'stellar'
              ? `Mint USDC on ${destName} (forwarder)`
              : `Mint USDC on ${destName}`;
    steps.push({ key: 'mint', label: mintLabel, status: 'pending' });

    return steps;
}

export type HashKind = 'evm' | 'solana' | 'stellarish';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/**
 * Classify a burn hash by shape. Hex forms are case insensitive and get
 * lowercased; base58 Solana signatures are case SENSITIVE and must never be
 * normalized. 'stellarish' covers bare 64 hex chains (Stellar today).
 */
export function classifyHash(input: string): { kind: HashKind; normalized: string } | null {
    const hash = input.trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        return { kind: 'evm', normalized: hash.toLowerCase() };
    }
    if (/^[0-9a-fA-F]{64}$/.test(hash)) {
        return { kind: 'stellarish', normalized: hash.toLowerCase() };
    }
    if (BASE58_RE.test(hash)) {
        return { kind: 'solana', normalized: hash };
    }
    return null;
}

/** Ordered list of source domains worth probing for a hash of this shape. */
export function candidateDomains(kind: HashKind, registry: Registry): number[] {
    if (kind === 'stellarish') return [registry.stellar.domain];
    if (kind === 'solana') {
        return registry.chains.filter((c) => c.family === 'solana').map((c) => c.domain);
    }
    return registry.chains.filter((c) => c.family === 'evm').map((c) => c.domain);
}
