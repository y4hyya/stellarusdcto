import { Account, TransactionBuilder, rpc, type xdr } from '@stellar/stellar-sdk';
import { STELLAR } from '$lib/config';
import { TransferError } from '$lib/errors/codes';
import { sleep } from '$lib/utils';
import { STELLAR_TAG_MIN_TIME, tagEnabled } from '../attribution/tag';
import { stellarRpc, transactionStatus, type StellarTxStatus } from './client';
import { signXdr } from './freighter';

type BuiltTx = ReturnType<TransactionBuilder['build']>;

/** How long a submitted transaction stays valid, in seconds. */
export const STELLAR_TX_TIMEOUT_S = 180;

/**
 * Time bounds for a transaction built now. The upper bound is the usual
 * timeout. The lower bound is 0 for an ordinary transaction, or the public
 * usage tag: a fixed time in the past, which every ledger already satisfies,
 * so it changes nothing about when the transaction can land. Contract
 * transactions reject memos outright, which is why the tag lives here.
 */
export function stellarTimebounds(
    minTime: number,
    nowMs: number = Date.now(),
): { minTime: number; maxTime: number } {
    return { minTime, maxTime: Math.floor(nowMs / 1000) + STELLAR_TX_TIMEOUT_S };
}

/**
 * A builder for one contract call that can be asked for the tagged or the
 * plain transaction. Every call builds from a fresh Account at the same
 * sequence: TransactionBuilder increments the account it is given, and a
 * second build off the same object would be for the wrong slot.
 */
export function contractCallBuilder(args: {
    caller: string;
    sequence: string;
    fee: string;
    networkPassphrase: string;
    operation: xdr.Operation;
}): (minTime: number) => BuiltTx {
    return (minTime) =>
        new TransactionBuilder(new Account(args.caller, args.sequence), {
            fee: args.fee,
            networkPassphrase: args.networkPassphrase,
            timebounds: stellarTimebounds(minTime),
        })
            .addOperation(args.operation)
            .build();
}

/**
 * Choose between the tagged and the plain transaction. The tagged one is
 * simulated first and used only if that simulation is clean. Anything else
 * (a failed simulation, an RPC error) falls through to the plain transaction,
 * whose own simulation result is returned whatever it says, so the error a
 * user sees is exactly the one they would have seen before the tag existed.
 */
export async function pickTaggedOrPlain<T, S>(args: {
    build: (minTime: number) => T;
    simulate: (tx: T) => Promise<S>;
    failed: (sim: S) => boolean;
    enabled: boolean;
}): Promise<{ tx: T; sim: S; tagged: boolean }> {
    if (args.enabled) {
        try {
            const tx = args.build(STELLAR_TAG_MIN_TIME);
            const sim = await args.simulate(tx);
            if (!args.failed(sim)) return { tx, sim, tagged: true };
        } catch {
            // Building or simulating the tagged one went wrong: the plain
            // attempt below decides.
        }
    }
    const tx = args.build(0);
    return { tx, sim: await args.simulate(tx), tagged: false };
}

// Simulate, prepare, sign with Freighter, submit, poll until SUCCESS or FAILED.
// Returns the on-chain transaction hash.
export async function simulateSignAndSubmit(tx: BuiltTx): Promise<string> {
    const sim = await stellarRpc.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
        throw new Error(`Soroban simulation failed: ${sim.error}`);
    }
    const prepared = rpc.assembleTransaction(tx, sim).build();
    return signAndSubmit(prepared);
}

// The same, for the transactions that carry the usage tag when it is on (the
// burn and the mint): `build` is asked for the tagged transaction first and
// for the plain one if that does not simulate cleanly.
export async function simulateSignAndSubmitTagged(
    build: (minTime: number) => BuiltTx,
): Promise<string> {
    const { tx, sim } = await pickTaggedOrPlain({
        build,
        simulate: (candidate) => stellarRpc.simulateTransaction(candidate),
        failed: (result) => rpc.Api.isSimulationError(result),
        enabled: tagEnabled(),
    });
    if (rpc.Api.isSimulationError(sim)) {
        throw new Error(`Soroban simulation failed: ${sim.error}`);
    }
    const prepared = rpc.assembleTransaction(tx, sim).build();
    return signAndSubmit(prepared);
}

// Classic operations (ChangeTrust and friends) never touch the Soroban
// simulator: sign and submit directly.
export async function signAndSubmitClassic(tx: BuiltTx): Promise<string> {
    return signAndSubmit(tx);
}

/**
 * How long to poll for a submitted transaction, in epoch ms: until its own
 * timebound passes plus a grace window for the closing ledger to propagate.
 * Once that deadline expires the network can never include the transaction,
 * which is what makes "safe to retry" a guarantee rather than a hope.
 */
export function pollDeadline(maxTime: string | undefined, now: number): number {
    const bound = Number(maxTime ?? 0);
    if (!bound) return now + 90_000;
    return Math.max(bound * 1000, now) + 15_000;
}

/**
 * Wait for a submitted transaction to be included. Only the status word is
 * read, as plain JSON, so nothing about how Stellar encodes results can make
 * a transaction that landed look like one that did not. A status read that
 * fails says nothing about the transaction, so the wait goes on. If the node
 * gives no answer by the deadline the outcome is UNKNOWN, which is not
 * EXPIRED: an expired transaction can never land, an unknown one may have.
 */
export async function waitForTransaction(args: {
    hash: string;
    deadline: number;
    status: (hash: string) => Promise<StellarTxStatus>;
    now?: () => number;
    pause?: (ms: number) => Promise<void>;
}): Promise<'SUCCESS' | 'FAILED' | 'EXPIRED' | 'UNKNOWN'> {
    const now = args.now ?? Date.now;
    const pause = args.pause ?? sleep;
    let unanswered = true;
    while (now() < args.deadline) {
        try {
            const status = await args.status(args.hash);
            unanswered = false;
            if (status !== 'NOT_FOUND') return status;
        } catch {
            unanswered = true;
        }
        await pause(1000);
    }
    return unanswered ? 'UNKNOWN' : 'EXPIRED';
}

async function signAndSubmit(tx: BuiltTx): Promise<string> {
    const signedXdr = await signXdr(tx.toXDR());
    const signed = TransactionBuilder.fromXDR(signedXdr, STELLAR.networkPassphrase);

    const send = await stellarRpc.sendTransaction(signed);
    if (send.status === 'ERROR') {
        throw new Error(`Submission rejected: ${JSON.stringify(send.errorResult)}`);
    }

    const deadline = pollDeadline(
        'timeBounds' in signed ? signed.timeBounds?.maxTime : undefined,
        Date.now(),
    );
    const outcome = await waitForTransaction({
        hash: send.hash,
        deadline,
        status: transactionStatus,
    });
    if (outcome === 'SUCCESS') return send.hash;
    if (outcome === 'FAILED') throw new Error(`Transaction failed on-chain: ${send.hash}`);
    if (outcome === 'UNKNOWN') {
        throw new TransferError('STELLAR_TX_UNCONFIRMED', {
            raw: `submitted, outcome not read: ${send.hash}`,
        });
    }
    throw new TransferError('STELLAR_TX_EXPIRED', { raw: `expired unsubmitted: ${send.hash}` });
}
