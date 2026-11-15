export function isRetryable(error) {
  if (!error) return false;
  if (error.retryable === false) return false;
  if (error.retryable === true || error.code === 'TIMEOUT') return true;
  const status = error.status;
  if (status === 429 || (typeof status === 'number' && status >= 500)) return true;
  if (typeof status === 'number' && status >= 400 && status < 500) return false;
  return true;
}

export function withTimeout(promise, timeoutMs, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      error.code = 'TIMEOUT';
      error.retryable = true;
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

export async function withRetry(fn, options = {}) {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 15000;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const label = options.label || 'operation';
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(Promise.resolve().then(() => fn(attempt)), timeoutMs, label);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetryable(error)) break;
      await sleep(baseDelayMs * (2 ** attempt));
    }
  }
  throw lastError;
}
