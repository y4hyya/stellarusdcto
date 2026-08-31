import { formatUsdc } from '$lib/amounts';

// The one button. It always names the actual next step instead of sitting
// disabled with no explanation, and the ladder below is the whole flow
// logic, so it stays a pure function with tests.

export type CtaInput = {
    busy: boolean;
    sourceConnected: boolean;
    /** Connect copy for the source family, e.g. "Connect Freighter". */
    connectLabel: string;
    wrongNetwork: boolean;
    amountText: string;
    /** Plain message when the amount fails to parse, otherwise null. */
    amountError: string | null;
    amount6: bigint | null;
    /** Source balance in 6 decimal units; null while unknown (never blocks). */
    balance6: bigint | null;
    recipientState: 'empty' | 'invalid' | 'checking' | 'problem' | 'ok';
    /** Short plain label when recipientState is 'problem'. */
    recipientProblem: string | null;
    destLabel: string;
};

export type Cta = {
    kind:
        | 'busy'
        | 'connect-source'
        | 'switch-network'
        | 'enter-amount'
        | 'fix-amount'
        | 'insufficient'
        | 'enter-recipient'
        | 'fix-recipient'
        | 'checking'
        | 'send';
    label: string;
    enabled: boolean;
};

export function resolveCta(input: CtaInput): Cta {
    if (input.busy) {
        return { kind: 'busy', label: 'Transfer in progress…', enabled: false };
    }
    if (!input.sourceConnected) {
        return { kind: 'connect-source', label: input.connectLabel, enabled: true };
    }
    if (input.wrongNetwork) {
        return { kind: 'switch-network', label: 'Switch network', enabled: true };
    }
    if (input.amountText.trim() === '') {
        return { kind: 'enter-amount', label: 'Enter an amount', enabled: false };
    }
    if (input.amountError !== null || input.amount6 === null) {
        return {
            kind: 'fix-amount',
            label: input.amountError ?? 'Enter a valid amount',
            enabled: false,
        };
    }
    if (input.balance6 !== null && input.amount6 > input.balance6) {
        return { kind: 'insufficient', label: 'Not enough USDC', enabled: false };
    }
    if (input.recipientState === 'empty') {
        return { kind: 'enter-recipient', label: 'Enter a recipient', enabled: false };
    }
    if (input.recipientState === 'invalid') {
        return {
            kind: 'fix-recipient',
            label: `That is not a ${input.destLabel} address`,
            enabled: false,
        };
    }
    if (input.recipientState === 'problem') {
        return {
            kind: 'fix-recipient',
            label: input.recipientProblem ?? 'Recipient cannot receive USDC yet',
            enabled: false,
        };
    }
    if (input.recipientState === 'checking') {
        return { kind: 'checking', label: 'Checking the recipient…', enabled: false };
    }
    return { kind: 'send', label: `Send ${formatUsdc(input.amount6)} USDC`, enabled: true };
}
