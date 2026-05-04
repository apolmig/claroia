import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPrompt, generateSummary, evaluateSummary, normalizeEndpointUrl, resolveJudgeRuntime } from './llmService';
import { AppConfig, ToneType, FormatType, JudgeCriteria, RunConfiguration } from '../types';
import { DEFAULT_PRIVACY_FILTER_CONFIG } from './privacyFilterService';
import * as requestQueue from '../src/utils/requestQueue';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock requestQueue to avoid actual retries during tests
vi.mock('../src/utils/requestQueue', async (importOriginal) => {
    const actual = await importOriginal<typeof requestQueue>();
    return {
        ...actual,
        retryWithBackoff: vi.fn(async (fn) => fn()), // Execute immediately without retry
    };
});

describe('llmService', () => {
    const mockConfig: AppConfig = {
        provider: 'local',
        activeModels: ['mistral'],
        modelVersion: '',
        cloudEndpoint: '',
        cloudApiKey: '',
        localEndpoint: 'http://localhost:1234/v1/chat/completions',
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 100,
        systemInstruction: 'System prompt',
        tone: ToneType.PROFESSIONAL,
        format: FormatType.PARAGRAPH,
        customFocus: '',
        maxWords: 100,
        runConfigurations: [],
        activeRunConfigs: [],
        judgeProvider: 'local',
        judgeModel: '',
        judgeEndpoint: '',
        useMainModelAsJudge: false,
        judgeCriteria: [],
        privacyFilter: DEFAULT_PRIVACY_FILTER_CONFIG
    };

    beforeEach(() => {
        mockFetch.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllEnvs();
    });

    describe('buildPrompt', () => {
        it('should include the source text', () => {
            const text = 'Hello world';
            const prompt = buildPrompt(text, mockConfig);
            expect(prompt).toContain('Original Text:\n"Hello world"');
        });

        it('should include tone and format', () => {
            const prompt = buildPrompt('test', mockConfig);
            expect(prompt).toContain(`Tone: ${ToneType.PROFESSIONAL}`);
            expect(prompt).toContain(`Format: ${FormatType.PARAGRAPH}`);
        });

        it('should include max words requirement', () => {
            const prompt = buildPrompt('test', mockConfig);
            expect(prompt).toContain('Maximum Length: 100 words');
        });

        it('should include custom focus when provided', () => {
            const configWithFocus = { ...mockConfig, customFocus: 'key metrics' };
            const prompt = buildPrompt('test', configWithFocus);
            expect(prompt).toContain('Pay special attention to: key metrics');
        });

        it('should include JSON format instructions when format is JSON', () => {
            const configWithJson = { ...mockConfig, format: FormatType.JSON };
            const prompt = buildPrompt('test', configWithJson);
            expect(prompt).toContain("valid JSON object");
            expect(prompt).toContain("'summary' key");
        });

        it('should include language constraint', () => {
            const prompt = buildPrompt('test', mockConfig);
            expect(prompt).toContain('LANGUAGE CONSTRAINT');
            expect(prompt).toContain('EXACT SAME LANGUAGE');
        });
    });

    describe('generateSummary - validation', () => {
        it('should throw error for empty text', async () => {
            await expect(generateSummary('', mockConfig)).rejects.toThrow(
                'Input text is required and cannot be empty'
            );
        });

        it('should throw error for whitespace-only text', async () => {
            await expect(generateSummary('   ', mockConfig)).rejects.toThrow(
                'Input text is required and cannot be empty'
            );
        });

        it('should throw error when no model is selected', async () => {
            const configNoModel = { ...mockConfig, activeModels: [] };
            await expect(generateSummary('test text', configNoModel)).rejects.toThrow(
                'No model selected'
            );
        });

        it('should throw error for cloud provider without API key', async () => {
            const cloudConfig = {
                ...mockConfig,
                provider: 'cloud' as const,
                cloudEndpoint: 'https://api.example.com',
                cloudApiKey: ''
            };
            await expect(generateSummary('test text', cloudConfig)).rejects.toThrow(
                'API key is required for cloud provider'
            );
        });

        it('should throw error for cloud provider without endpoint', async () => {
            const cloudConfig = {
                ...mockConfig,
                provider: 'cloud' as const,
                cloudEndpoint: '',
                cloudApiKey: 'test-key'
            };
            await expect(generateSummary('test text', cloudConfig)).rejects.toThrow(
                'Cloud endpoint is required for cloud provider'
            );
        });

        it('should throw error for local provider without endpoint', async () => {
            const localConfig = {
                ...mockConfig,
                provider: 'local' as const,
                localEndpoint: ''
            };
            await expect(generateSummary('test text', localConfig)).rejects.toThrow(
                'Local endpoint is required for local provider'
            );
        });
    });

    describe('generateSummary - API calls', () => {
        it('should make successful API call and return content', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'Generated summary' } }]
                })
            });

            const result = await generateSummary('Test input text', mockConfig);
            expect(result).toBe('Generated summary');
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('routes every request through the Netlify proxy in public demo mode', async () => {
            vi.stubEnv('VITE_APP_MODE', 'netlify');
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'Generated summary' } }]
                })
            });

            const result = await generateSummary('Test input text', mockConfig);

            expect(result).toBe('Generated summary');
            expect(mockFetch).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('http://localhost:1234/v1/chat/completions')
            }));
        });

        it('should throw specific error for 401 status', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: async () => 'Unauthorized'
            });

            await expect(generateSummary('test', mockConfig)).rejects.toThrow(
                'Authentication failed: Invalid API key'
            );
        });

        it('should throw specific error for 429 status', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 429,
                text: async () => 'Rate limited'
            });

            await expect(generateSummary('test', mockConfig)).rejects.toThrow(
                'Rate limit exceeded'
            );
        });

        it('should throw specific error for 404 status', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                text: async () => 'Not found'
            });

            await expect(generateSummary('test', mockConfig)).rejects.toThrow(
                'not found or endpoint incorrect'
            );
        });

        it('should throw error when response has no content', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ choices: [{ message: {} }] })
            });

            await expect(generateSummary('test', mockConfig)).rejects.toThrow(
                'No content in API response'
            );
        });

        it('should abort in-flight API calls', async () => {
            const controller = new AbortController();
            mockFetch.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(new DOMException('Request aborted', 'AbortError')));
            }));

            const request = generateSummary('test', mockConfig, undefined, { signal: controller.signal });
            controller.abort();

            await expect(request).rejects.toMatchObject({ name: 'AbortError' });
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('endpoint and judge runtime helpers', () => {
        it('normalizes common chat completion endpoint forms', () => {
            expect(normalizeEndpointUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions');
            expect(normalizeEndpointUrl('https://api.openai.com/v1/models')).toBe('https://api.openai.com/v1/chat/completions');
            expect(normalizeEndpointUrl('https://api.openai.com/v1/chat/completions')).toBe('https://api.openai.com/v1/chat/completions');
        });

        it('uses dedicated judge endpoint when configured', () => {
            const runConfig: RunConfiguration = {
                id: 'run-1',
                name: 'Run',
                provider: 'local',
                model: 'main-model',
                systemInstruction: 'sys',
                temperature: 0.1,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 100,
                tone: ToneType.PROFESSIONAL,
                format: FormatType.PARAGRAPH,
                customFocus: '',
                maxWords: 100
            };

            const runtime = resolveJudgeRuntime({
                ...mockConfig,
                judgeProvider: 'cloud',
                judgeModel: 'judge-model',
                judgeEndpoint: 'https://judge.example.com/v1',
                cloudApiKey: 'secret'
            }, runConfig);

            expect(runtime.model).toBe('judge-model');
            expect(runtime.endpoint).toBe('https://judge.example.com/v1');
            expect(runtime.apiKey).toBe('secret');
        });

        it('uses main run config when main-model judging is enabled', () => {
            const runConfig: RunConfiguration = {
                id: 'run-1',
                name: 'Run',
                provider: 'local',
                model: 'main-model',
                systemInstruction: 'sys',
                temperature: 0.1,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 100,
                tone: ToneType.PROFESSIONAL,
                format: FormatType.PARAGRAPH,
                customFocus: '',
                maxWords: 100
            };

            const runtime = resolveJudgeRuntime({
                ...mockConfig,
                useMainModelAsJudge: true,
                judgeEndpoint: '',
                judgeModel: ''
            }, runConfig);

            expect(runtime.model).toBe('main-model');
            expect(runtime.endpoint).toBe(mockConfig.localEndpoint);
        });
    });

    describe('evaluateSummary', () => {
        const mockCriteria: JudgeCriteria[] = [
            { id: '1', name: 'ACCURACY', weight: 50, description: 'Test accuracy' },
            { id: '2', name: 'CLARITY', weight: 50, description: 'Test clarity' }
        ];

        it('should return error result for empty original text', async () => {
            const result = await evaluateSummary(
                '', 'summary', mockCriteria, 'local', 'model', 'http://localhost:1234', ''
            );
            expect(result.score).toBe(0);
            expect(result.note).toContain('Missing original text');
        });

        it('should return error result for empty summary', async () => {
            const result = await evaluateSummary(
                'original', '', mockCriteria, 'local', 'model', 'http://localhost:1234', ''
            );
            expect(result.score).toBe(0);
            expect(result.note).toContain('Missing');
        });

        it('should return error result for missing model', async () => {
            const result = await evaluateSummary(
                'original', 'summary', mockCriteria, 'local', '', 'http://localhost:1234', ''
            );
            expect(result.score).toBe(0);
            expect(result.note).toContain('not configured');
        });

        it('should return error result for empty criteria', async () => {
            const result = await evaluateSummary(
                'original', 'summary', [], 'local', 'model', 'http://localhost:1234', ''
            );
            expect(result.score).toBe(0);
            expect(result.note).toContain('No criteria defined');
        });

        it('should parse valid evaluation response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                score: 8,
                                note: 'Good summary',
                                criteriaScores: { ACCURACY: 8, CLARITY: 8 }
                            })
                        }
                    }]
                })
            });

            const result = await evaluateSummary(
                'original text', 'summary text', mockCriteria,
                'local', 'gpt-4', 'http://localhost:1234', ''
            );

            expect(result.score).toBe(8);
            expect(result.note).toBe('Good summary');
            expect(result.criteriaScores).toEqual({ ACCURACY: 8, CLARITY: 8 });
        });

        it('should handle JSON parsing errors gracefully', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: { content: 'not valid json' }
                    }]
                })
            });

            const result = await evaluateSummary(
                'original', 'summary', mockCriteria,
                'local', 'gpt-4', 'http://localhost:1234', ''
            );

            expect(result.score).toBe(0);
            expect(result.note).toContain('Error parsing');
        });

        it('should clamp scores to 0-10 range', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                score: 15, // Over 10
                                note: 'Test',
                                criteriaScores: { ACCURACY: -5 } // Under 0
                            })
                        }
                    }]
                })
            });

            const result = await evaluateSummary(
                'original', 'summary', mockCriteria,
                'local', 'gpt-4', 'http://localhost:1234', ''
            );

            expect(result.score).toBe(10); // Clamped to max
            expect(result.criteriaScores?.ACCURACY).toBe(0); // Clamped to min
        });

        it('should indicate when reference summary was used', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({ score: 7, note: 'Compared' })
                        }
                    }]
                })
            });

            const result = await evaluateSummary(
                'original', 'summary', mockCriteria,
                'local', 'gpt-4', 'http://localhost:1234', '',
                'reference summary here'
            );

            expect(result.comparedToReference).toBe(true);
        });
    });
});
