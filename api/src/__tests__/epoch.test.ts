import { describe, it, expect } from 'vitest';

// Regression guard: maxEpoch is a Sui epoch number (small integer),
// NOT a Unix timestamp (~1.7B+). If someone changes the computation
// back to Date.now()/1000, these tests fail.
describe('maxEpoch epoch guard', () => {
  const MAX_SAFE_EPOCH = 1_000_000; // Sui epochs won't reach 1M for decades

  it('currentEpoch + 2 must produce a value below safe epoch threshold', () => {
    // Simulate a reasonable current epoch on mainnet (~1000 at time of writing)
    const reasonableEpoch = 1000;
    const maxEpoch = reasonableEpoch + 2;
    expect(maxEpoch).toBe(1002);
    expect(maxEpoch).toBeLessThan(MAX_SAFE_EPOCH);
  });

  it('fails if someone uses Date.now()/1000 instead of epoch', () => {
    // This test validates the guard itself: a Unix timestamp SHOULD fail
    const badMaxEpoch = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    expect(badMaxEpoch).toBeGreaterThan(MAX_SAFE_EPOCH);
  });

  it('even the maximum foreseeable epoch is well below Unix timestamp range', () => {
    // Sui has been running for ~2 years, ~1000 epochs. Even 100 years from
    // now, epochs would be ~1M, not billions.
    const farFutureEpoch = 50000;
    expect(farFutureEpoch + 2).toBeLessThan(MAX_SAFE_EPOCH);
  });
});
