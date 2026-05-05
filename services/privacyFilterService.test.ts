import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    applyPrivacyFilter,
    combinePrivacyMetadata,
    DEFAULT_PRIVACY_FILTER_CONFIG,
    maskFromSpans,
    metadataFromPrivacyResult
} from './privacyFilterService';
import { AppConfig, FormatType, ToneType } from '../types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const baseConfig: AppConfig = {
    provider: 'cloud',
    activeModels: ['model'],
    modelVersion: '',
    cloudEndpoint: 'https://api.openai.com/v1',
    cloudApiKey: 'key',
    localEndpoint: 'http://localhost:1234/v1/chat/completions',
    temperature: 0.5,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 100,
    systemInstruction: 'sys',
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

describe('privacyFilterService', () => {
    beforeEach(() => {
        mockFetch.mockReset();
    });

    it('masks enabled categories from spans', () => {
        const masked = maskFromSpans('Email alice@example.com now', [
            { start: 6, end: 23, label: 'private_email', score: 0.99, textPreview: 'alice@example.com' }
        ]);

        expect(masked).toBe('Email [PRIVATE_EMAIL] now');
    });

    it('ignores overlapping lower-priority spans after sorting', () => {
        const masked = maskFromSpans('Call Alice Smith', [
            { start: 5, end: 10, label: 'private_person', score: 0.9, textPreview: 'Alice' },
            { start: 5, end: 16, label: 'private_person', score: 0.95, textPreview: 'Alice Smith' }
        ]);

        expect(masked).toBe('Call [PRIVATE_PERSON]');
    });

    it('blocks cloud calls when sidecar is unavailable and blocking is enabled', async () => {
        mockFetch.mockRejectedValueOnce(new Error('connection refused'));

        await expect(applyPrivacyFilter('hello alice@example.com', {
            ...baseConfig,
            privacyFilter: {
                ...DEFAULT_PRIVACY_FILTER_CONFIG,
                enabled: true,
                mode: 'mask',
                blockOnUnavailable: true
            }
        }, 'cloud')).rejects.toThrow('Privacy Filter blocked request');
    });

    it('blocks local calls in mask mode when sidecar is unavailable and blocking is enabled', async () => {
        mockFetch.mockRejectedValueOnce(new Error('connection refused'));

        await expect(applyPrivacyFilter('hello alice@example.com', {
            ...baseConfig,
            privacyFilter: {
                ...DEFAULT_PRIVACY_FILTER_CONFIG,
                enabled: true,
                mode: 'mask',
                blockOnUnavailable: true
            }
        }, 'local')).rejects.toThrow('Privacy Filter blocked request');
    });

    it('blocks mask mode even when blockOnUnavailable is disabled', async () => {
        mockFetch.mockRejectedValueOnce(new Error('connection refused'));

        await expect(applyPrivacyFilter('hello alice@example.com', {
            ...baseConfig,
            privacyFilter: {
                ...DEFAULT_PRIVACY_FILTER_CONFIG,
                enabled: true,
                mode: 'mask',
                blockOnUnavailable: false
            }
        }, 'local')).rejects.toThrow('Privacy Filter blocked request');
    });

    it('does not mark metadata as masked when no spans were detected', () => {
        const metadata = metadataFromPrivacyResult({
            originalLength: 11,
            maskedText: 'hello world',
            spans: [],
            countsByCategory: {
                private_person: 0,
                private_address: 0,
                private_email: 0,
                private_phone: 0,
                private_url: 0,
                private_date: 0,
                account_number: 0,
                secret: 0
            },
            runtime: 'local-sidecar',
            filteredAt: 1
        }, 'mask');

        expect(metadata.masked).toBe(false);
    });

    it('combines source and reference privacy metadata', () => {
        const counts = {
            private_person: 0,
            private_address: 0,
            private_email: 0,
            private_phone: 0,
            private_url: 0,
            private_date: 0,
            account_number: 0,
            secret: 0
        };

        const combined = combinePrivacyMetadata({
            masked: false,
            mode: 'mask',
            runtime: 'local-sidecar',
            countsByCategory: { ...counts, private_email: 1 },
            originalLength: 10,
            filteredAt: 10
        }, {
            masked: true,
            mode: 'mask',
            runtime: 'local-sidecar',
            countsByCategory: { ...counts, private_person: 2 },
            originalLength: 20,
            filteredAt: 20
        });

        expect(combined.masked).toBe(true);
        expect(combined.countsByCategory.private_email).toBe(1);
        expect(combined.countsByCategory.private_person).toBe(2);
        expect(combined.originalLength).toBe(30);
        expect(combined.filteredAt).toBe(20);
    });

    it('marks combined metadata unavailable unless both scans used the sidecar', () => {
        const counts = {
            private_person: 0,
            private_address: 0,
            private_email: 0,
            private_phone: 0,
            private_url: 0,
            private_date: 0,
            account_number: 0,
            secret: 0
        };

        const combined = combinePrivacyMetadata({
            masked: true,
            mode: 'mask',
            runtime: 'local-sidecar',
            countsByCategory: counts,
            originalLength: 10,
            filteredAt: 10
        }, {
            masked: false,
            mode: 'mask',
            runtime: 'unavailable',
            countsByCategory: counts,
            originalLength: 20,
            filteredAt: 20
        });

        expect(combined.runtime).toBe('unavailable');
    });

    it('returns masked text from local sidecar spans', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ version: 'test', modelLoaded: true })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    spans: [
                        { start: 6, end: 23, label: 'private_email', score: 0.99, textPreview: 'alice@example.com' }
                    ]
                })
            });

        const result = await applyPrivacyFilter('Email alice@example.com now', {
            ...baseConfig,
            privacyFilter: {
                ...DEFAULT_PRIVACY_FILTER_CONFIG,
                enabled: true,
                mode: 'mask',
                blockOnUnavailable: true
            }
        }, 'cloud');

        expect(result.text).toBe('Email [PRIVATE_EMAIL] now');
        expect(result.metadata.masked).toBe(true);
        expect(result.metadata.countsByCategory.private_email).toBe(1);
    });
});
