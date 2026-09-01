import { TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import { STELLAR } from '$lib/config';
import { TransferError } from '$lib/errors/codes';
import { sleep } from '$lib/utils';
import { stellarRpc } from './client';
import { signXdr } from './freighter';

// Simulate, prepare, sign with Freighter, submit, poll until SUCCESS or FAILED.
// Returns the on-chain transaction hash.
export async function simulateSignAndSubmit(
    tx: ReturnType<TransactionBuilder['build']>,
): Promise<string> {
    const sim = await stellarRpc.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
        throw new Error(`Soroban simulation failed: ${sim.error}`);
    }
    const prepared = rpc.assembleTransaction(tx, sim).build();
    return signAndSubmit(prepared);
}

// Classic operations (ChangeTrust and friends) never touch the Soroban
// simulator: sign and submit directly.
export async function signAndSubmitClassic(
    tx: ReturnType<TransactionBuilder['build']>,
): Promise<string> {
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

async function signAndSubmit(tx: ReturnType<TransactionBuilder['build']>): Promise<string> {
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
    while (Date.now() < deadline) {
        const got = await stellarRpc.getTransaction(send.hash);
        if (got.status === 'SUCCESS') return send.hash;
        if (got.status === 'FAILED') {
            throw new Error(`Transaction failed on-chain: ${send.hash}`);
        }
        await sleep(1000);
    }
    throw new TransferError('STELLAR_TX_EXPIRED', { raw: `expired unsubmitted: ${send.hash}` });
}
