/**
 * Utility helpers
 */

export async function fetchWithRetry(
  url: string,
  options: { retries?: number; delay?: number } = {}
): Promise<Response> {
  const { retries = 3, delay = 1000 } = options;
  
  let lastError: Error | null = null;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000),
      });
      
      if (response.ok || response.status < 500) {
        return response;
      }
      
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err: any) {
      lastError = err;
    }
    
    if (i < retries - 1) {
      await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
    }
  }
  
  throw lastError || new Error('Request failed after retries');
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function generateId(prefix: string = ''): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}