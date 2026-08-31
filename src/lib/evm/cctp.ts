import { encodeFunctionData, erc20Abi, toHex, type Hex } from 'viem';
import { EVM_CCTP_CONTRACTS, EVM_CHAINS, type EvmChainId } from '$lib/config';
import { getPublicClient } from './client';
import type { EvmWallet } from './wallet';

// ─────────────────────────────────────────────────────────────────────
//  EVM side of CCTP V2
// ─────────────────────────────────────────────────────────────────────
//
// CCTP V2 burns USDC on the source EVM chain and emits a signed message
// Circle attests. The destination calls `receiveMessage` to mint fresh
// USDC. For a Stellar destination the burn cannot deliver directly to a
// G-address, because CCTP messages address a 32-byte slot and there's no way
// to tell a G-account from a C-contract on the wire, so `mintRecipient` and
// `destinationCaller` must both be the CctpForwarder with the recipient in
// `hookData`. Those slots arrive here pre composed as a MintTarget from the
// destination adapter, which owns and tests that invariant.

// Minimal ABIs for the V2 contracts. Full ABIs are large and we only call
// these two methods.
export const tokenMessengerV2Abi = [
    {
        type: 'function',
        name: 'depositForBurnWithHook',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'amount', type: 'uint256' },
            { name: 'destinationDomain', type: 'uint32' },
            { name: 'mintRecipient', type: 'bytes32' },
            { name: 'burnToken', type: 'address' },
            { name: 'destinationCaller', type: 'bytes32' },
            { name: 'maxFee', type: 'uint256' },
            { name: 'minFinalityThreshold', type: 'uint32' },
            { name: 'hookData', type: 'bytes' },
        ],
        outputs: [],
    },
] as const;

export const messageTransmitterV2Abi = [
    {
        type: 'function',
        name: 'receiveMessage',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'message', type: 'bytes' },
            { name: 'attestation', type: 'bytes' },
        ],
        outputs: [{ type: 'bool' }],
    },
] as const;

// Generalized burns used by the transfer engine. The 32 byte slots and hook
// data arrive as a MintTarget composed by the destination adapter, so the
// fund safety rules live in exactly one place (src/lib/adapters).
type EngineMintTarget = import('../adapters/types').MintTarget;

function targetToArgs(
    chainId: EvmChainId,
    amount: bigint,
    destinationDomain: number,
    target: EngineMintTarget,
    maxFee: bigint,
    finalityThreshold: number,
) {
    const cfg = EVM_CHAINS[chainId];
    return {
        cfg,
        burnArgs: [
            amount,
            destinationDomain,
            toHex(target.mintRecipient),
            cfg.usdc,
            toHex(target.destinationCaller),
            maxFee,
            finalityThreshold,
            target.hookData ? toHex(target.hookData) : ('0x' as Hex),
        ] as const,
    };
}

export async function evmBurnToTarget(args: {
    chainId: EvmChainId;
    wallet: EvmWallet;
    amount: bigint;
    destinationDomain: number;
    target: EngineMintTarget;
    maxFee: bigint;
    finalityThreshold: number;
}): Promise<`0x${string}`> {
    const { cfg, burnArgs } = targetToArgs(
        args.chainId,
        args.amount,
        args.destinationDomain,
        args.target,
        args.maxFee,
        args.finalityThreshold,
    );
    const hash = await args.wallet.walletClient.writeContract({
        account: args.wallet.address,
        chain: cfg.chain,
        address: EVM_CCTP_CONTRACTS.tokenMessengerV2,
        abi: tokenMessengerV2Abi,
        functionName: 'depositForBurnWithHook',
        args: burnArgs,
    });
    await getPublicClient(args.chainId).waitForTransactionReceipt({ hash });
    return hash;
}

export async function evmSendCallsBurnToTarget(args: {
    chainId: EvmChainId;
    wallet: EvmWallet;
    amount: bigint;
    destinationDomain: number;
    target: EngineMintTarget;
    maxFee: bigint;
    finalityThreshold: number;
}): Promise<`0x${string}`> {
    const { cfg, burnArgs } = targetToArgs(
        args.chainId,
        args.amount,
        args.destinationDomain,
        args.target,
        args.maxFee,
        args.finalityThreshold,
    );
    const approveData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [EVM_CCTP_CONTRACTS.tokenMessengerV2, args.amount],
    });
    const burnData = encodeFunctionData({
        abi: tokenMessengerV2Abi,
        functionName: 'depositForBurnWithHook',
        args: burnArgs,
    });
    const { id } = await args.wallet.walletClient.sendCalls({
        account: args.wallet.address,
        chain: cfg.chain,
        calls: [
            { to: cfg.usdc, data: approveData },
            { to: EVM_CCTP_CONTRACTS.tokenMessengerV2, data: burnData },
        ],
    });
    const status = await args.wallet.walletClient.waitForCallsStatus({ id });
    if (status.status !== 'success') {
        throw new Error(`wallet_sendCalls did not confirm (status: ${status.status})`);
    }
    const receipts = status.receipts ?? [];
    const burn = receipts[receipts.length - 1];
    if (!burn?.transactionHash) {
        throw new Error('No burn receipt returned from wallet_sendCalls');
    }
    return burn.transactionHash;
}

// Whether a CCTP nonce was already consumed on this chain. The public
// usedNonces mapping is the free pre mint check and the post mint proof;
// Iris status never says minted.
const usedNoncesAbi = [
    {
        type: 'function',
        name: 'usedNonces',
        stateMutability: 'view',
        inputs: [{ name: 'nonce', type: 'bytes32' }],
        outputs: [{ type: 'uint256' }],
    },
] as const;

export async function isNonceUsedOnEvm(
    entry: { id: string; messageTransmitter: `0x${string}` },
    nonce: Hex,
): Promise<boolean> {
    const used = await getPublicClient(entry.id as EvmChainId).readContract({
        address: entry.messageTransmitter,
        abi: usedNoncesAbi,
        functionName: 'usedNonces',
        args: [nonce],
    });
    return used === 1n;
}

// Inverse direction (Stellar → EVM): after Circle attests, anyone can
// submit the message + signature to MessageTransmitterV2 and mint USDC
// to the embedded recipient. `receiveMessage` is permissionless when
// the burn's `destinationCaller` was set to zero (our convention for
// outbound transfers from Stellar, see stellar/cctp.ts).
//
// Wire call:  MessageTransmitterV2.receiveMessage(message, attestation)
//
// Returns the mint tx hash.
export async function receiveMessageOnEvm(args: {
    chainId: EvmChainId;
    wallet: EvmWallet;
    message: Hex;
    attestation: Hex;
}): Promise<`0x${string}`> {
    const cfg = EVM_CHAINS[args.chainId];
    const hash = await args.wallet.walletClient.writeContract({
        account: args.wallet.address,
        chain: cfg.chain,
        address: EVM_CCTP_CONTRACTS.messageTransmitterV2,
        abi: messageTransmitterV2Abi,
        functionName: 'receiveMessage',
        args: [args.message, args.attestation],
    });
    await getPublicClient(args.chainId).waitForTransactionReceipt({ hash });
    return hash;
}
