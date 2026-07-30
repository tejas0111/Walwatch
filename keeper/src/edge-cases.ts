export async function verifyOnChainStateBeforeRetry(
  blobId: string,
  aggregatorUrl: string,
): Promise<{ verified: boolean; currentState: any }> {
  try {
    const response = await fetch(`${aggregatorUrl}/v1/blobs/${blobId}/status`);
    const state = await response.json();
    return { verified: true, currentState: state };
  } catch {
    return { verified: false, currentState: null };
  }
}
