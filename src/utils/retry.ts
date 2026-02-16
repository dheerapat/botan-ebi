export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly lastError: unknown,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = "RetryError";
  }
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  },
): Promise<T> {
  let lastError: unknown;
  let delay = options.initialDelayMs;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === options.maxAttempts) {
        throw new RetryError(
          `Max retry attempts (${options.maxAttempts}) reached`,
          error,
          attempt,
        );
      }

      console.warn(
        `Attempt ${attempt}/${options.maxAttempts} failed, retrying in ${delay}ms...`,
        error,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));

      delay = Math.min(delay * options.backoffMultiplier, options.maxDelayMs);
    }
  }

  throw new RetryError(
    "Unexpected retry error",
    lastError,
    options.maxAttempts,
  );
}
