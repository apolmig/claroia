import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestQueue, retryWithBackoff } from './requestQueue';

describe('RequestQueue', () => {
    it('should limit concurrent requests', async () => {
        const queue = new RequestQueue(2);
        const executionOrder: number[] = [];

        const createTask = (id: number, delay: number) => async () => {
            executionOrder.push(id);
            await new Promise(resolve => setTimeout(resolve, delay));
            return id;
        };

        // Start 3 tasks with max concurrency of 2
        const promises = [
            queue.add(createTask(1, 50)),
            queue.add(createTask(2, 50)),
            queue.add(createTask(3, 50))
        ];

        // First two should start immediately
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(queue.getRunningCount()).toBeLessThanOrEqual(2);

        await Promise.all(promises);
        expect(executionOrder).toEqual([1, 2, 3]);
    });

    it('should return correct running count', () => {
        const queue = new RequestQueue(3);
        expect(queue.getRunningCount()).toBe(0);
    });

    it('should correctly report when full', async () => {
        const queue = new RequestQueue(1);
        expect(queue.isFull()).toBe(false);

        const promise = queue.add(async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return 'done';
        });

        // Give time for the task to start
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(queue.isFull()).toBe(true);

        await promise;
        expect(queue.isFull()).toBe(false);
    });
});

describe('retryWithBackoff', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should succeed on first try without retrying', async () => {
        const fn = vi.fn().mockResolvedValue('success');

        const resultPromise = retryWithBackoff(fn, 3, 1000);
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('Fail 1'))
            .mockRejectedValueOnce(new Error('Fail 2'))
            .mockResolvedValue('success');

        const resultPromise = retryWithBackoff(fn, 3, 100);

        // Fast-forward through all retries
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries exceeded', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

        const resultPromise = retryWithBackoff(fn, 2, 100);
        const expectation = expect(resultPromise).rejects.toThrow('Always fails');

        await vi.runAllTimersAsync();

        await expectation;
        expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should use exponential backoff delays', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('Fail'))
            .mockRejectedValueOnce(new Error('Fail'))
            .mockResolvedValue('success');

        const resultPromise = retryWithBackoff(fn, 3, 1000);

        // First call happens immediately
        expect(fn).toHaveBeenCalledTimes(1);

        // After 1000ms (first backoff)
        await vi.advanceTimersByTimeAsync(1000);
        expect(fn).toHaveBeenCalledTimes(2);

        // After 2000ms more (second backoff = 1000 * 2^1)
        await vi.advanceTimersByTimeAsync(2000);
        expect(fn).toHaveBeenCalledTimes(3);

        await vi.runAllTimersAsync();
        const result = await resultPromise;
        expect(result).toBe('success');
    });

    it('should not retry aborted requests', async () => {
        const abortError = new DOMException('Request aborted', 'AbortError');
        const fn = vi.fn().mockRejectedValue(abortError);

        await expect(retryWithBackoff(fn, 3, 100)).rejects.toMatchObject({ name: 'AbortError' });
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
