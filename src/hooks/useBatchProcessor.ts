import { useState, useRef, useCallback } from 'react';
import { AppConfig, BatchItem } from '../../types';
import { generateSummary, evaluateSummary, resolveJudgeRuntime } from '../../services/llmService';
import { applyPrivacyFilter, combinePrivacyMetadata } from '../../services/privacyFilterService';

interface UseBatchProcessorProps {
    config: AppConfig;
    batchItems: BatchItem[];
    setBatchItems: React.Dispatch<React.SetStateAction<BatchItem[]>>;
}

const RUN_CONFIG_CONCURRENCY = 2;

const runWithConcurrency = async <T,>(
    items: T[],
    limit: number,
    signal: AbortSignal,
    worker: (item: T) => Promise<void>
) => {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length && !signal.aborted) {
            const item = items[cursor];
            cursor += 1;
            await worker(item);
        }
    });
    await Promise.all(workers);
};

export const useBatchProcessor = ({ config, batchItems, setBatchItems }: UseBatchProcessorProps) => {
    const [isGenerating, setIsGenerating] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    const stopBatch = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setIsGenerating(false);
        }
    }, []);

    const processBatch = useCallback(async () => {
        if (batchItems.length === 0) return;
        if (config.activeRunConfigs.length === 0) {
            setBatchItems(prev => prev.map(item =>
                item.status === 'pending'
                    ? { ...item, status: 'error', error: 'No active run configurations selected' }
                    : item
            ));
            return;
        }

        setIsGenerating(true);
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        const pendingItems = batchItems.filter(i => i.status === 'pending');
        const activeRunConfigs = config.activeRunConfigs
            .map(configId => config.runConfigurations.find(c => c.id === configId))
            .filter(Boolean) as AppConfig['runConfigurations'];
        if (activeRunConfigs.length === 0) {
            setBatchItems(prev => prev.map(item =>
                item.status === 'pending'
                    ? { ...item, status: 'error', error: 'Active run configurations are missing' }
                    : item
            ));
            setIsGenerating(false);
            abortControllerRef.current = null;
            return;
        }

        try {
            for (const item of pendingItems) {
                if (signal.aborted) break;

                // Update status to processing
                setBatchItems(prev => prev.map(pi => pi.id === item.id ? { ...pi, status: 'processing' } : pi));

                try {
                    const itemResults: Record<string, string> = {};
                    const itemEvaluations: Record<string, any> = {};
                    const hasCloudRun = activeRunConfigs.some(runConfig => {
                        const judgeRuntime = resolveJudgeRuntime(config, runConfig);
                        return runConfig.provider === 'cloud' || Boolean(judgeRuntime.model && judgeRuntime.provider === 'cloud');
                    });
                    const privacyProvider = hasCloudRun ? 'cloud' : config.provider;
                    const privacyApplied = await applyPrivacyFilter(item.sourceText, config, privacyProvider, { signal });
                    const llmSourceText = privacyApplied.text;
                    let itemPrivacy: BatchItem['privacy'] = privacyApplied.metadata.mode === 'off' ? item.privacy : privacyApplied.metadata;
                    let maskedSourceText = privacyApplied.metadata.mode === 'mask' ? llmSourceText : item.maskedSourceText;
                    let referenceForJudge = item.referenceSummary;
                    let maskedReferenceSummary = item.maskedReferenceSummary;

                    if (item.referenceSummary && privacyApplied.metadata.mode === 'mask') {
                        const referencePrivacy = await applyPrivacyFilter(item.referenceSummary, config, privacyProvider, { signal });
                        referenceForJudge = referencePrivacy.text;
                        maskedReferenceSummary = referencePrivacy.text;
                        itemPrivacy = combinePrivacyMetadata(privacyApplied.metadata, referencePrivacy.metadata);
                    }
                    const generationPrivacy = itemPrivacy || privacyApplied.metadata;

                    await runWithConcurrency(activeRunConfigs, RUN_CONFIG_CONCURRENCY, signal, async (runConfig) => {
                        if (signal.aborted) return;

                        const tempConfig: AppConfig = {
                            ...config,
                            provider: runConfig.provider,
                            activeModels: [runConfig.model],
                            systemInstruction: runConfig.systemInstruction,
                            temperature: runConfig.temperature,
                            topK: runConfig.topK,
                            topP: runConfig.topP,
                            maxOutputTokens: runConfig.maxOutputTokens,
                            tone: runConfig.tone,
                            format: runConfig.format,
                            customFocus: runConfig.customFocus,
                            maxWords: runConfig.maxWords
                        };

                        try {
                            const judgeRuntime = resolveJudgeRuntime(config, runConfig);
                            const shouldJudge = Boolean(judgeRuntime.model);
                            const result = await generateSummary(llmSourceText, tempConfig, runConfig.model, { signal });
                            if (signal.aborted) return;

                            itemResults[runConfig.id] = result;

                            try {
                                if (shouldJudge) {
                                    if (signal.aborted) return;

                                    const evaluation = await evaluateSummary(
                                        llmSourceText,
                                        result,
                                        config.judgeCriteria,
                                        judgeRuntime.provider,
                                        judgeRuntime.model,
                                        judgeRuntime.endpoint,
                                        judgeRuntime.apiKey,
                                        referenceForJudge,
                                        { signal }
                                    );

                                    itemEvaluations[runConfig.id] = {
                                        score: evaluation.score,
                                        note: itemPrivacy?.masked ? `Privacy-filtered input. ${evaluation.note}` : evaluation.note,
                                        isGroundTruth: false,
                                        criteriaScores: evaluation.criteriaScores,
                                        comparedToReference: evaluation.comparedToReference
                                    };
                                }
                            } catch (evalErr) {
                                itemEvaluations[runConfig.id] = { score: 0, note: "Evaluation failed", isGroundTruth: false };
                            }

                        } catch (e: any) {
                            if (signal.aborted || e?.name === 'AbortError') return;
                            itemResults[runConfig.id] = `Error: ${e.message}`;
                            itemEvaluations[runConfig.id] = { score: 0, note: "Generation failed", isGroundTruth: false };
                        }
                    });

                    if (signal.aborted) break;

                    setBatchItems(prev => prev.map(pi => pi.id === item.id ? {
                        ...pi,
                        status: 'done',
                        results: itemResults,
                        resultsPrivacy: Object.keys(itemResults).reduce((acc, configId) => {
                            acc[configId] = generationPrivacy;
                            return acc;
                        }, {} as NonNullable<BatchItem['resultsPrivacy']>),
                        evaluations: itemEvaluations,
                        privacy: itemPrivacy,
                        maskedSourceText,
                        maskedReferenceSummary
                    } : pi));
                } catch (e: any) {
                    if (signal.aborted || e?.name === 'AbortError') break;
                    setBatchItems(prev => prev.map(pi => pi.id === item.id ? {
                        ...pi,
                        status: 'error',
                        error: e?.message || 'Batch item failed'
                    } : pi));
                }
            }
        } finally {
            if (signal.aborted) {
                setBatchItems(prev => prev.map(item =>
                    item.status === 'processing' ? { ...item, status: 'pending' } : item
                ));
            }
            setIsGenerating(false);
            abortControllerRef.current = null;
        }
    }, [batchItems, config, setBatchItems]);

    return { isGenerating, processBatch, stopBatch };
};
