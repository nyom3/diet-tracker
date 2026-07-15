export async function withImageDecodeRetry<T>(
  operation: () => Promise<T>,
  delayMs: number,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await wait(delayMs);
      }
    }
  }

  throw lastError;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}
