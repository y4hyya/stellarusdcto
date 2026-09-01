import {
    Account,
    Address,
    BASE_FEE,
    Contract,
    TransactionBuilder,
    nativeToScVal,
    scValToNative,
    xdr,
} from '@stellar/stellar-sdk';
import { STELLAR } from '$lib/config';
import { stellarRpc } from './client';
import { simulateSignAndSubmit } from './tx';
import { inclusionFee } from './fees';

const tmm = new Contract(STELLAR.contracts.tokenMessengerMinter);
const forwarder = new Contract(STELLAR.contracts.cctpForwarder);

// ─────────────────────────────────────────────────────────────────────
//  EXPERIMENTAL: Circle Crosschain Forwarding Service trigger (outbound)
// ─────────────────────────────────────────────────────────────────────
// The forwarded flag on stellarDepositForBurn switches the burn to
// deposit_for_burn_with_hook with this magic hookData. Circle's relayer watches
// source chains for this magic and auto-completes the destination mint,
// deducting its fee from the minted USDC, so the user pays no destination gas.
//
// hookData layout (Circle docs):
//   bytes 0-23 : 24-byte magic, ascii "cctp-forward" left-aligned, zero-padded
//   bytes 24-27: u32 version (0)
//   bytes 28-31: u32 length of additional Circle hook data (0, none here)
//
// Stellar is NOT a documented forwarding source; this probes whether the relayer
// picks it up regardless. destination_caller is left ZERO (permissionless) so if
// the relayer ignores the burn, the mint can still be completed manually via
// receiveMessage (the demo's resume flow), so funds are never stranded.
export const CCTP_FORWARD_MAGIC = 'cctp-forward';

export function encodeCctpForwardHookData(): Uint8Array {
    // 32 bytes total: 24 magic + u32 version + u32 length, all-zero tail. Writing
    // the ascii magic at offset 0 leaves the magic padding, version, and length
    // fields at their zero defaults, exactly the documented "no extra data" form.
    const out = new Uint8Array(32);
    out.set(new TextEncoder().encode(CCTP_FORWARD_MAGIC), 0);
    return out;
}

// Inbound from EVM: mint_and_forward is permissionless (no caller arg).
// The user pays the Soroban fee but doesn't need to be the recipient.
export async function mintAndForward(args: {
    caller: string;
    message: Uint8Array;
    attestation: Uint8Array;
}): Promise<{ hash: string }> {
    const account = await stellarRpc.getAccount(args.caller);

    const tx = new TransactionBuilder(account, {
        fee: await inclusionFee(),
        networkPassphrase: STELLAR.networkPassphrase,
    })
        .addOperation(
            forwarder.call(
                'mint_and_forward',
                nativeToScVal(args.message, { type: 'bytes' }),
                nativeToScVal(args.attestation, { type: 'bytes' }),
            ),
        )
        .setTimeout(180)
        .build();

    const hash = await simulateSignAndSubmit(tx);
    return { hash };
}

// Generalized burn used by the transfer engine: destination and slots come
// from the destination adapter's MintTarget, so the slot composition rules
// live in exactly one place (src/lib/adapters). A Stellar source never burns
// toward Stellar itself, so target.hookData is always null here; the
// forwarded variant adds Circle's forwarding magic instead.
export async function stellarDepositForBurn(args: {
    caller: string;
    amount: bigint; // Stellar 7 decimal subunits
    destinationDomain: number;
    target: import('../adapters/types').MintTarget;
    maxFee: bigint;
    finalityThreshold: number;
    forwarded?: boolean;
}): Promise<{ hash: string; sourceDomain: number }> {
    const account = await stellarRpc.getAccount(args.caller);
    const common = [
        Address.fromString(args.caller).toScVal(),
        nativeToScVal(args.amount, { type: 'i128' }),
        nativeToScVal(args.destinationDomain, { type: 'u32' }),
        bytesN32(args.target.mintRecipient),
        Address.fromString(STELLAR.contracts.usdc).toScVal(),
        bytesN32(args.target.destinationCaller),
        nativeToScVal(args.maxFee, { type: 'i128' }),
        nativeToScVal(args.finalityThreshold, { type: 'u32' }),
    ];
    const operation = args.forwarded
        ? tmm.call(
              'deposit_for_burn_with_hook',
              ...common,
              nativeToScVal(encodeCctpForwardHookData(), { type: 'bytes' }),
          )
        : tmm.call('deposit_for_burn', ...common);

    const tx = new TransactionBuilder(account, {
        fee: await inclusionFee(),
        networkPassphrase: STELLAR.networkPassphrase,
    })
        .addOperation(operation)
        .setTimeout(180)
        .build();

    const hash = await simulateSignAndSubmit(tx);
    return { hash, sourceDomain: STELLAR.domain };
}

// Read whether a CCTP nonce was already consumed on Stellar, the on chain
// truth behind "was this transfer minted". Iris only knows attested, never
// minted. Simulation needs an existing source account, so pass any funded
// viewer (normally the connected wallet).
export async function isNonceUsedOnStellar(nonce: Uint8Array, viewer: string): Promise<boolean> {
    const mt = new Contract(STELLAR.contracts.messageTransmitter);
    const account = await stellarRpc.getAccount(viewer).catch(() => new Account(viewer, '0'));
    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR.networkPassphrase,
    })
        .addOperation(mt.call('is_nonce_used', bytesN32(nonce)))
        .setTimeout(30)
        .build();
    const sim = await stellarRpc.simulateTransaction(tx);
    if ('error' in sim && sim.error) {
        throw new Error(`Soroban simulation failed: ${sim.error}`);
    }
    const result = (sim as { result?: { retval: unknown } }).result;
    return result ? scValToNative(result.retval as never) === true : false;
}

export function leftPad32FromHex(hex: `0x${string}`): Uint8Array {
    const clean = hex.toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]+$/.test(clean) || clean.length > 64) {
        throw new Error(`Invalid hex address: ${hex}`);
    }
    const bytes = new Uint8Array(32);
    for (let i = 0; i < clean.length / 2; i++) {
        bytes[32 - clean.length / 2 + i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function bytesN32(bytes: Uint8Array): xdr.ScVal {
    if (bytes.length !== 32) throw new Error(`bytesN32 expects 32 bytes, got ${bytes.length}`);
    return nativeToScVal(bytes, { type: 'bytes' });
}
