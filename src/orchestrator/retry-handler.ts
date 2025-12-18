import { logger } from '../utils/logger.js';
import type { RetryConfig } from '../types/config.js';

export class RetryExhaustedError extends Error {
  constructor(
    public readonly operationName: string,
    public readonly lastError: Error,
    public readonly attempts: number
  ) {
    super(`Operation "${operationName}" failed after ${attempts} attempts: ${lastError.message}`);
    this.name = 'RetryExhaustedError';
  }
}

export interface RetryOptions {
  config: RetryConfig;
  operationName: string;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

/**
 * Execute an operation with retry logic and exponential backoff
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { config, operationName, onRetry } = options;
  const retryLogger = logger.child('retry');

  let lastError: Error = new Error('Unknown error');
  let delay = config.delayMs;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      retryLogger.debug(`[${operationName}] Attempt ${attempt}/${config.maxAttempts}`);
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      retryLogger.warn(`[${operationName}] Attempt ${attempt} failed: ${lastError.message}`);

      if (attempt < config.maxAttempts) {
        retryLogger.info(`[${operationName}] Retrying in ${delay}ms...`);

        if (onRetry) {
          onRetry(attempt, lastError, delay);
        }

        await sleep(delay);
        delay *= config.backoffMultiplier;
      }
    }
  }

  retryLogger.error(`[${operationName}] All ${config.maxAttempts} attempts failed`);
  throw new RetryExhaustedError(operationName, lastError, config.maxAttempts);
}

/**
 * Execute multiple operations with retry, returning results for all (success or failure)
 */
export async function executeAllWithRetry<T>(
  operations: Array<{
    name: string;
    operation: () => Promise<T>;
  }>,
  config: RetryConfig
): Promise<Array<{ name: string; result?: T; error?: Error }>> {
  const results = await Promise.allSettled(
    operations.map(async ({ name, operation }) => {
      try {
        const result = await executeWithRetry(operation, {
          config,
          operationName: name,
        });
        return { name, result };
      } catch (error) {
        return { name, error: error instanceof Error ? error : new Error(String(error)) };
      }
    })
  );

  return results.map((result) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      name: 'unknown',
      error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
    };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
