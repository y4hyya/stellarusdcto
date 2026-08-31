import { fetchEncodedAccount, getProgramDerivedAddress } from '@solana/kit';
import { MESSAGE_TRANSMITTER_V2_PROGRAM_ADDRESS } from './generated/message-transmitter';
import { solanaRpc } from './client';

// Whether a CCTP nonce was already consumed on Solana. receiveMessage
// creates a used_nonce account at a nonce derived address, so existence of
// that account is the on chain minted proof (Iris never says minted).
export async function isNonceUsedOnSolana(nonce: Uint8Array): Promise<boolean> {
    const [usedNonce] = await getProgramDerivedAddress({
        programAddress: MESSAGE_TRANSMITTER_V2_PROGRAM_ADDRESS,
        seeds: ['used_nonce', nonce],
    });
    const info = await fetchEncodedAccount(solanaRpc, usedNonce);
    return info.exists;
}
