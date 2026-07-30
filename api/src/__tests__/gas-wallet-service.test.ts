import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mysten/sui/jsonRpc', () => {
  const mockGetCoins = vi.fn();
  const MockSuiJsonRpcClient = vi.fn(() => ({
    getCoins: mockGetCoins,
  }));
  return { SuiJsonRpcClient: MockSuiJsonRpcClient };
});

const { selectGasCoin } = await import('../services/gas-wallet-service.js');

const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');

describe('selectGasCoin', () => {
  let mockGetCoins: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const instance = (SuiJsonRpcClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    mockGetCoins = instance?.getCoins ?? vi.fn();
    mockGetCoins.mockReset();
  });

  it('returns the full object reference (objectId, version, digest), not just the id', async () => {
    const owner = '0xca75e6295db99f6ca121ac3e257f8b09abedd9b7f67775fc5eb50e6d3bce0000';
    mockGetCoins.mockResolvedValue({
      data: [
        {
          coinObjectId: '0xcoin1',
          version: '42',
          digest: 'EDkd3p69zJ5aJk',
          balance: '1000000000',
          coinType: '0x2::sui::SUI',
        },
      ],
    });

    const ref = await selectGasCoin(owner);

    expect(ref).toEqual({
      objectId: '0xcoin1',
      version: '42',
      digest: 'EDkd3p69zJ5aJk',
    });
    expect(mockGetCoins).toHaveBeenCalledWith({
      owner,
      coinType: '0x2::sui::SUI',
    });
  });

  it('throws a clear error when the gas wallet has no SUI coins', async () => {
    const owner = '0xemptywallet';
    mockGetCoins.mockResolvedValue({ data: [] });

    await expect(selectGasCoin(owner)).rejects.toThrow(
      'No SUI gas coins found for gas wallet',
    );
  });
});
