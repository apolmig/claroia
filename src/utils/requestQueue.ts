/**
 * Request queue utility for throttling concurrent API requests
 * Prevents overwhelming APIs with too many simultaneous requests
 */
export class RequestQueue {
    private queue: Array<() => Promise<any>> = [];
    private running = 0;

    /**
     * @param maxConcurrent Maximum number of concurrent requests allowed
     */
    constructor(private maxConcurrent = 3) { }

    /**
     * Add a request to the queue and execute when slot is available
     * @param fn Async function to execute
     * @returns Promise that resolves with the function's result
     */
    async add<T>(fn: () => Promise<T>): Promise<T> {
        // Wait for an available slot
        while (this.running >= this.maxConcurrent) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.running++;
        try {
            return await fn();
        } finally {
            this.running--;
        }
    }

    /**
     * Get current number of running requests
     */
    getRunningCount(): number {
        return this.running;
    }

    /**
     * Check if queue is at capacity
     */
    isFull(): boolean {
        return this.running >= this.maxConcurrent;
    }
}

/**
 * Retry a function with exponential backoff
 * @param fn Function to retry
 * @param maxRetries Maximum number of retry attempts
 * @param baseDelay Base delay in milliseconds (will be multiplied by 2^attempt)
 * @returns Promise that resolves with the function's result
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 1000
): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (lastError.name === 'AbortError') {
                throw lastError;
            }

            // Don't retry on last attempt
            if (attempt === maxRetries) {
                break;
            }

            // Calculate exponential backoff delay
            const delay = baseDelay * Math.pow(2, attempt);

            console.warn(
                `Request failed (attempt ${attempt + 1}/${maxRetries + 1}). ` +
                `Retrying in ${delay}ms...`,
                lastError.message
            );

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError || new Error('Request failed after retries');
}
