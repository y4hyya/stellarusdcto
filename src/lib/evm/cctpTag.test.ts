import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { encodeFunctionData, erc20Abi, type Hex } from 'viem';
import type { MintTarget } from '../adapters/types';
import { EVM_TAG_SUFFIX } from '../attribution/tag';

// The node behind the pinned RPC is the only thing replaced here: the gate,
// the encoding and the send paths are the real ones.
const node = vi.hoisted(() => ({
    simulateContract: vi.fn(),
    call: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
}));
vi.mock('./client', () => ({ getPublicClient: () => node }));

const {
    burnCall,
    evmBurnToTarget,
    evmSendCallsBurnToTarget,
    receiveMessageOnEvm,
    tokenMessengerV2Abi,
} = await import('./cctp');
const { EVM_CHAINS } = await import('$lib/config');

const chainId = Object.keys(EVM_CHAINS)[0];
const cfg = EVM_CHAINS[chainId];
const ADDRESS = '0x00000000000000000000000000000000000000Aa' as const;
const BARE_SUFFIX = EVM_TAG_SUFFIX.slice(2);

// A Stellar bound burn: the forwarder in both slots, the recipient in hook data.
const target: MintTarget = {
    mintRecipient: new Uint8Array(32).fill(7),
    destinationCaller: new Uint8Array(32).fill(7),
    hookData: new Uint8Array([1, 2, 3]),
};
const burn = {
    chainId,
    amount: 1_000_000n,
    destinationDomain: 27,
    target,
    maxFee: 500n,
    finalityThreshold: 2000,
};
const burnData = encodeFunctionData({
    abi: tokenMessengerV2Abi,
    ...burnCall(cfg.usdc, burn.amount, burn.destinationDomain, target, burn.maxFee, 2000),
});
const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [cfg.tokenMessenger, burn.amount],
});

function fakeWallet() {
    const walletClient = {
        writeContract: vi.fn<(request: unknown) => Promise<Hex>>(async () => '0xaaaa'),
        sendCalls: vi.fn<(request: unknown) => Promise<{ id: string }>>(async () => ({
            id: 'batch',
        })),
        waitForCallsStatus: vi.fn(async () => ({
            status: 'success',
            receipts: [
                { transactionHash: '0xaaaa', status: 'success' },
                { transactionHash: '0xbbbb', status: 'success' },
            ],
        })),
    };
    const wallet = { address: ADDRESS, chainId: cfg.chain.id, walletClient, provider: {} };
    return { wallet: wallet as never, walletClient };
}

const tagOn = () => vi.stubGlobal('location', { hostname: 'testnet.stablehops.com' } as Location);

beforeEach(() => {
    node.simulateContract.mockReset().mockResolvedValue({});
    node.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: 'success' });
    // By default the node treats tagged and untagged calls alike.
    node.call.mockReset().mockResolvedValue({ data: '0x' });
});
afterEach(() => vi.unstubAllGlobals());

describe('the batched burn (wallet_sendCalls)', () => {
    test('tags the burn call and leaves the approve untouched', async () => {
        tagOn();
        const { wallet, walletClient } = fakeWallet();
        await evmSendCallsBurnToTarget({ ...burn, wallet });
        const { calls } = walletClient.sendCalls.mock.calls[0][0] as unknown as {
            calls: { to: string; data: Hex }[];
        };
        expect(calls).toHaveLength(2);
        expect(calls[0]).toEqual({ to: cfg.usdc, data: approveData });
        expect(calls[1]).toEqual({ to: cfg.tokenMessenger, data: burnData + BARE_SUFFIX });
    });

    test('asks the gate about the burn call, from the user address', async () => {
        tagOn();
        const { wallet } = fakeWallet();
        await evmSendCallsBurnToTarget({ ...burn, wallet });
        const asked = node.call.mock.calls.map(([request]) => request);
        expect(asked).toHaveLength(2);
        for (const request of asked) {
            expect(request.account).toBe(ADDRESS);
            expect(request.to).toBe(cfg.tokenMessenger);
        }
        expect(asked.map((r) => r.data).sort()).toEqual([burnData, burnData + BARE_SUFFIX].sort());
    });

    test('sends the plain burn when the tag is off, without simulating', async () => {
        const { wallet, walletClient } = fakeWallet();
        await evmSendCallsBurnToTarget({ ...burn, wallet });
        const { calls } = walletClient.sendCalls.mock.calls[0][0] as unknown as {
            calls: { data: Hex }[];
        };
        expect(calls[1].data).toBe(burnData);
        expect(node.call).not.toHaveBeenCalled();
    });

    test('sends the plain burn when the two simulations disagree', async () => {
        tagOn();
        node.call.mockImplementation(async ({ data }: { data: Hex }) => ({
            data: data.endsWith(BARE_SUFFIX) ? '0x02' : '0x01',
        }));
        const { wallet, walletClient } = fakeWallet();
        await evmSendCallsBurnToTarget({ ...burn, wallet });
        const { calls } = walletClient.sendCalls.mock.calls[0][0] as unknown as {
            calls: { data: Hex }[];
        };
        expect(calls[1].data).toBe(burnData);
    });
});

describe('the plain burn', () => {
    test('keeps the untagged pre signature simulation and hands the suffix to the wallet', async () => {
        tagOn();
        const { wallet, walletClient } = fakeWallet();
        await evmBurnToTarget({ ...burn, wallet });
        expect(node.simulateContract).toHaveBeenCalledTimes(1);
        expect(node.simulateContract.mock.calls[0][0].dataSuffix).toBeUndefined();
        const sent = walletClient.writeContract.mock.calls[0][0] as unknown as {
            address: string;
            functionName: string;
            dataSuffix?: Hex;
        };
        expect(sent.address).toBe(cfg.tokenMessenger);
        expect(sent.functionName).toBe('depositForBurnWithHook');
        expect(sent.dataSuffix).toBe(EVM_TAG_SUFFIX);
    });

    test('a burn without hook data is tagged the same way', async () => {
        tagOn();
        const { wallet, walletClient } = fakeWallet();
        await evmBurnToTarget({ ...burn, wallet, target: { ...target, hookData: null } });
        const sent = walletClient.writeContract.mock.calls[0][0] as unknown as {
            functionName: string;
            dataSuffix?: Hex;
        };
        expect(sent.functionName).toBe('depositForBurn');
        expect(sent.dataSuffix).toBe(EVM_TAG_SUFFIX);
    });

    test('sends no suffix when the tag is off', async () => {
        const { wallet, walletClient } = fakeWallet();
        await evmBurnToTarget({ ...burn, wallet });
        const sent = walletClient.writeContract.mock.calls[0][0] as unknown as {
            dataSuffix?: Hex;
        };
        expect(sent.dataSuffix).toBeUndefined();
        expect(node.call).not.toHaveBeenCalled();
    });

    test('sends no suffix when the tagged simulation fails', async () => {
        tagOn();
        node.call.mockImplementation(async ({ data }: { data: Hex }) => {
            if (data.endsWith(BARE_SUFFIX)) throw new Error('execution reverted');
            return { data: '0x' };
        });
        const { wallet, walletClient } = fakeWallet();
        await evmBurnToTarget({ ...burn, wallet });
        const sent = walletClient.writeContract.mock.calls[0][0] as unknown as {
            dataSuffix?: Hex;
        };
        expect(sent.dataSuffix).toBeUndefined();
    });

    test('a burn that would revert still never reaches the wallet', async () => {
        tagOn();
        node.simulateContract.mockRejectedValue(new Error('would revert'));
        const { wallet, walletClient } = fakeWallet();
        await expect(evmBurnToTarget({ ...burn, wallet })).rejects.toThrow('would revert');
        expect(walletClient.writeContract).not.toHaveBeenCalled();
    });
});

describe('the mint', () => {
    const mint = { chainId, message: '0x1234' as Hex, attestation: '0xabcd' as Hex };

    test('hands the suffix to the wallet after the untagged simulation', async () => {
        tagOn();
        const { wallet, walletClient } = fakeWallet();
        await receiveMessageOnEvm({ ...mint, wallet });
        expect(node.simulateContract.mock.calls[0][0].dataSuffix).toBeUndefined();
        const sent = walletClient.writeContract.mock.calls[0][0] as unknown as {
            address: string;
            dataSuffix?: Hex;
        };
        expect(sent.address).toBe(cfg.messageTransmitter);
        expect(sent.dataSuffix).toBe(EVM_TAG_SUFFIX);
        for (const [request] of node.call.mock.calls) {
            expect(request.to).toBe(cfg.messageTransmitter);
        }
    });

    test('sends no suffix when the tag is off', async () => {
        const { wallet, walletClient } = fakeWallet();
        await receiveMessageOnEvm({ ...mint, wallet });
        const sent = walletClient.writeContract.mock.calls[0][0] as unknown as {
            dataSuffix?: Hex;
        };
        expect(sent.dataSuffix).toBeUndefined();
    });
});
