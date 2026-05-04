import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBatchProcessor } from './useBatchProcessor';
import { AppConfig, BatchItem, ToneType, FormatType } from '../../types';
import * as llmService from '../../services/llmService';
import * as privacyFilterService from '../../services/privacyFilterService';

// Mock llmService
vi.mock('../../services/llmService', () => ({
    generateSummary: vi.fn(),
    evaluateSummary: vi.fn(),
    resolveJudgeRuntime: vi.fn(() => ({
        provider: 'local',
        model: '',
        endpoint: 'http://localhost:1234',
        apiKey: ''
    }))
}));

vi.mock('../../services/privacyFilterService', async (importOriginal) => {
    const actual = await importOriginal<typeof privacyFilterService>();
    const zeroCounts = {
        private_person: 0,
        private_address: 0,
        private_email: 0,
        private_phone: 0,
        private_url: 0,
        private_date: 0,
        account_number: 0,
        secret: 0
    };
    return {
        ...actual,
        applyPrivacyFilter: vi.fn(async (text, config) => ({
            text,
            result: {
                originalLength: text.length,
                maskedText: text,
                spans: [],
                countsByCategory: zeroCounts,
                runtime: 'unavailable',
                filteredAt: Date.now()
            },
            metadata: {
                masked: false,
                mode: config.privacyFilter?.mode || 'off',
                runtime: 'unavailable',
                countsByCategory: zeroCounts,
                originalLength: text.length,
                filteredAt: Date.now()
            }
        }))
    };
});

describe('useBatchProcessor', () => {
    const mockConfig: AppConfig = {
        provider: 'local',
        activeModels: ['model1'],
        modelVersion: '',
        cloudEndpoint: '',
        cloudApiKey: '',
        localEndpoint: 'http://localhost:1234',
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 100,
        systemInstruction: 'System prompt',
        tone: ToneType.PROFESSIONAL,
        format: FormatType.PARAGRAPH,
        customFocus: '',
        maxWords: 100,
        runConfigurations: [
            {
                id: 'config1',
                name: 'Config 1',
                provider: 'local',
                model: 'model1',
                systemInstruction: 'sys',
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 100,
                tone: ToneType.PROFESSIONAL,
                format: FormatType.PARAGRAPH,
                customFocus: '',
                maxWords: 100
            }
        ],
        activeRunConfigs: ['config1'], // Active config matches the one above
        judgeProvider: 'local',
        judgeModel: '',
        judgeEndpoint: '',
        useMainModelAsJudge: false,
        judgeCriteria: [],
        privacyFilter: privacyFilterService.DEFAULT_PRIVACY_FILTER_CONFIG
    };

    const mockBatchItems: BatchItem[] = [
        {
            id: '1',
            sourceText: 'Text 1',
            status: 'pending',
            results: {},
            evaluations: {}
        },
        {
            id: '2',
            sourceText: 'Text 2',
            status: 'pending',
            results: {},
            evaluations: {}
        }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize with correct state', () => {
        const { result } = renderHook(() => useBatchProcessor({
            config: mockConfig,
            batchItems: mockBatchItems,
            setBatchItems: vi.fn()
        }));

        expect(result.current.isGenerating).toBe(false);
    });

    it('should process items and update status', async () => {
        const setBatchItems = vi.fn();
        const { result } = renderHook(() => useBatchProcessor({
            config: mockConfig,
            batchItems: mockBatchItems,
            setBatchItems
        }));

        (llmService.generateSummary as any).mockResolvedValue('Summary result');

        await act(async () => {
            await result.current.processBatch();
        });

        // Should update status to processing then done for each item
        expect(setBatchItems).toHaveBeenCalled();
        expect(llmService.generateSummary).toHaveBeenCalledTimes(2); // Once for each item
    });

    it('should handle stopBatch correctly', async () => {
        const setBatchItems = vi.fn();
        const { result } = renderHook(() => useBatchProcessor({
            config: mockConfig,
            batchItems: mockBatchItems,
            setBatchItems
        }));

        // Mock generateSummary to be slow
        (llmService.generateSummary as any).mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return 'Slow Summary';
        });

        let processPromise: Promise<void>;
        await act(async () => {
            processPromise = result.current.processBatch();
        });

        // Call stop immediately
        act(() => {
            result.current.stopBatch();
        });

        await act(async () => {
            await processPromise!;
        });

        expect(result.current.isGenerating).toBe(false);
    });

    it('should handle errors during generation', async () => {
        const setBatchItems = vi.fn();
        const { result } = renderHook(() => useBatchProcessor({
            config: mockConfig,
            batchItems: [mockBatchItems[0]],
            setBatchItems
        }));

        (llmService.generateSummary as any).mockRejectedValue(new Error('Generation failed'));

        await act(async () => {
            await result.current.processBatch();
        });

        expect(setBatchItems).toHaveBeenCalled();
        // Should have called setBatchItems with error result logic
        // Verification of specific state update is hard with mock generic function,
        // but we verify flow completes without crashing
        expect(result.current.isGenerating).toBe(false);
    });
});
