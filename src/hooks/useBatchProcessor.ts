import { useState, useRef, useCallback } from 'react';
import { AppConfig, BatchItem } from '../../types';
import { generateSummary, evaluateSummary, resolveJudgeRuntime } from '../../services/llmService';
import { applyPrivacyFilter } from '../../services/privacyFilterService';

interface UseBatchProcessorProps {
    config: AppConfig;
    batchItems: BatchItem[];
    setBatchItems: React.Dispatch<React.SetStateAction<BatchItem[]>>;
}

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

        // Process items that are not 'done'
        const pendingItems = batchItems.filter(i => i.status !== 'done');

        try {
            for (const item of pendingItems) {
                if (signal.aborted) break;

                // Update status to processing
                setBatchItems(prev => prev.map(pi => pi.id === item.id ? { ...pi, status: 'processing' } : pi));

                const itemResults: Record<string, string> = {};
                const itemEvaluations: Record<string, any> = {};
                let itemPrivacy: BatchItem['privacy'] = item.privacy;
                let maskedSourceText = item.maskedSourceText;
                let maskedReferenceSummary = item.maskedReferenceSummary;

                // Run all active configurations for this item
                // Note: internal concurrency for configs is fine, but we might want to check signal inside this loop too
                await Promise.all(config.activeRunConfigs.map(async (configId) => {
                    if (signal.aborted) return;

                    const runConfig = config.runConfigurations.find(c => c.id === configId);
                    if (!runConfig) return;

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
                        const privacyProvider = runConfig.provider === 'cloud' || (shouldJudge && judgeRuntime.provider === 'cloud') ? 'cloud' : runConfig.provider;
                        const privacyApplied = await applyPrivacyFilter(item.sourceText, tempConfig, privacyProvider, { signal });
                        const llmSourceText = privacyApplied.text;
                        itemPrivacy = privacyApplied.metadata.mode === 'off' ? itemPrivacy : privacyApplied.metadata;
                        maskedSourceText = privacyApplied.metadata.masked ? llmSourceText : maskedSourceText;

                        let referenceForJudge = item.referenceSummary;
                        if (item.referenceSummary && privacyApplied.metadata.mode === 'mask') {
                            const referencePrivacy = await applyPrivacyFilter(item.referenceSummary, tempConfig, privacyProvider, { signal });
                            referenceForJudge = referencePrivacy.text;
                            maskedReferenceSummary = referencePrivacy.metadata.masked ? referencePrivacy.text : maskedReferenceSummary;
                        }

                        const result = await generateSummary(llmSourceText, tempConfig, runConfig.model, { signal });
                        if (signal.aborted) return;

                        itemResults[configId] = result;

                        // --- LLM Judge Evaluation ---
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

                                itemEvaluations[configId] = {
                                    score: evaluation.score,
                                    note: privacyApplied.metadata.masked ? `Privacy-filtered input. ${evaluation.note}` : evaluation.note,
                                    isGroundTruth: false,
                                    criteriaScores: evaluation.criteriaScores,
                                    comparedToReference: evaluation.comparedToReference
                                };
                            }
                        } catch (evalErr) {
                            itemEvaluations[configId] = { score: 0, note: "Evaluation failed", isGroundTruth: false };
                        }

                    } catch (e: any) {
                        if (signal.aborted || e?.name === 'AbortError') return;
                        itemResults[configId] = `Error: ${e.message}`;
                        itemEvaluations[configId] = { score: 0, note: "Generation failed", isGroundTruth: false };
                    }
                }));

                if (signal.aborted) break;

                // Update item with results and evaluations
                setBatchItems(prev => prev.map(pi => pi.id === item.id ? {
                    ...pi,
                    status: 'done',
                    results: itemResults,
                    evaluations: itemEvaluations,
                    privacy: itemPrivacy,
                    maskedSourceText,
                    maskedReferenceSummary
                } : pi));
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
