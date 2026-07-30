import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: { zkProverUrl: 'https://prover.example.com/v1' },
}));

const { generateZkProof } = await import('../services/zklogin-service.js');

describe('generateZkProof', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends maxEpoch in the prover request body', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        proofPoints: { a: [], b: [], c: [] },
        issBase64Details: { value: 'x', indexMod4: 0 },
        headerBase64: 'y',
      }),
    } as any);

    await generateZkProof('fake.jwt.token', new Uint8Array([1, 2, 3]), 'randomness123', 'salt456', 12345);

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as any).body as string);
    expect(body.maxEpoch).toBe('12345');
  });

  it('returns the exact maxEpoch it was given, not a derived/fabricated one', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        proofPoints: { a: [], b: [], c: [] },
        issBase64Details: { value: 'x', indexMod4: 0 },
        headerBase64: 'y',
      }),
    } as any);

    const result = await generateZkProof('fake.jwt.token', new Uint8Array([1, 2, 3]), 'randomness123', 'salt456', 99999);

    expect(result.maxEpoch).toBe(99999);
  });

  it('returns the proof in the exact shape the prover sent it, unmodified', async () => {
    const proverResponse = {
      proofPoints: { a: ['1'], b: [['2']], c: ['3'] },
      issBase64Details: { value: 'abc', indexMod4: 2 },
      headerBase64: 'def',
    };
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => proverResponse,
    } as any);

    const result = await generateZkProof('fake.jwt.token', new Uint8Array([1, 2, 3]), 'randomness123', 'salt456', 100);

    expect(result.proof).toEqual(proverResponse);
    expect(result.proof).not.toHaveProperty('maxEpoch');
  });

  it('throws a clear error when the prover returns non-OK status', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad request: missing field',
    } as any);

    await expect(generateZkProof('bad.jwt', new Uint8Array([1, 2, 3]), 'r', 's', 100)).rejects.toThrow(
      'ZK proof generation failed (400): Bad request: missing field',
    );
  });
});
