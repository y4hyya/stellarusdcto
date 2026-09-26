import { EVM_CHAINS, type EvmChainId } from '$lib/config';
import type { EvmWallet } from './wallet';

// What we ask about per chain: whether the wallet will run the approve and
// the burn as ONE atomic transaction behind one confirmation (EIP 5792
// wallet_sendCalls). That is the only batch we use; every other answer takes
// the two transaction flow, which simulates the burn on our own RPC first.
export type SendCallsCapability = {
    supported: boolean; // we batch on this chain (only ever when atomic)
    atomic: boolean; // calls run as a single atomic transaction
};

const UNSUPPORTED: SendCallsCapability = { supported: false, atomic: false };

// EIP-5792 capability discovery. Wallets that don't implement the method
// throw, so we treat any error or absence as "unsupported" rather than
// surfacing it, because the UI just disables a chip in that case.
//
// `atomic.status` per spec:
//   - 'supported' : the account already runs calls atomically (a smart
//                   wallet, or an EOA already delegated through EIP 7702).
//                   One transaction: we batch.
//   - 'ready'     : the wallet would first upgrade the EOA into a smart
//                   account, pending the user's approval. We don't batch:
//                   the upgrade is a persistent change to the user's account,
//                   and its first transaction is where MetaMask's gas
//                   estimate can break on chains its simulation service does
//                   not cover. On Unichain Sepolia it guessed 35% of the block gas
//                   limit (21,000,000) and the node refused the signed
//                   transaction with "gas limit too high" (EIP 7825 caps one
//                   transaction at 16,777,216).
//   - absent / other : no batching.
export async function fetchSendCallsCapability(
    wallet: EvmWallet,
    chainId: EvmChainId,
): Promise<SendCallsCapability> {
    const targetChainId = EVM_CHAINS[chainId].chain.id;
    try {
        const raw = await wallet.walletClient.getCapabilities({
            account: wallet.address,
            chainId: targetChainId,
        });
        // viem's overload returns either the single-chain Capabilities object
        // (when chainId is passed) or a record keyed by chainId. Real-world
        // wallets honor the single-chain shape; defensively unwrap if not.
        const caps =
            'atomic' in (raw as Record<string, unknown>)
                ? (raw as { atomic?: { status?: string } })
                : ((raw as Record<number, { atomic?: { status?: string } }>)[targetChainId] ?? {});
        const atomicStatus = caps.atomic?.status;
        if (atomicStatus === 'supported') return { supported: true, atomic: true };
        return UNSUPPORTED;
    } catch {
        return UNSUPPORTED;
    }
}
