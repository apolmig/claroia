
import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BatchItem, AppConfig, ValidationStatus } from '../types';
import { evaluateSummary, isJudgeRuntimeConfigured, resolveJudgeRuntime } from '../services/llmService';
import ReactMarkdown from 'react-markdown';
import { Star, Download, ChevronDown, ChevronRight, MessageSquare, FileJson, Check, Search, X, Target, ArrowUpDown, Settings, BookOpen, ThumbsUp, ThumbsDown, Filter } from 'lucide-react';

interface BatchResultsProps {
    items: BatchItem[];
    activeModels: string[]; // Legacy, kept for type compatibility but unused in new logic
    config: AppConfig;
    onUpdateEvaluation: (itemId: string, model: string, field: 'score' | 'note' | 'isGroundTruth' | 'criteriaScores' | 'comparedToReference', value: any) => void;
    onUpdateItem?: (itemId: string, field: 'referenceSummary' | 'humanValidated', value: any) => void;
}


const BatchResults: React.FC<BatchResultsProps> = ({ items, activeModels, config, onUpdateEvaluation, onUpdateItem }) => {
    const { t } = useTranslation();

    const [expandedRow, setExpandedRow] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortCriteria, setSortCriteria] = useState<'default' | 'consistency'>('default');
    const [filterMode, setFilterMode] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'low-score'>('all');
    const [showComparison, setShowComparison] = useState(false);
    const [showTrainingMenu, setShowTrainingMenu] = useState(false);


    // Layout State
    const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
    const [isMaximized, setIsMaximized] = useState(false);
    const [judgingItemId, setJudgingItemId] = useState<string | null>(null);

    // Batch Judge State
    const [isBatchJudging, setIsBatchJudging] = useState(false);
    const [batchJudgeProgress, setBatchJudgeProgress] = useState({ current: 0, total: 0 });

    const isAnyJudgeConfigured = config.activeRunConfigs.some(configId => {
        const runConfig = config.runConfigurations.find(c => c.id === configId);
        return runConfig ? isJudgeRuntimeConfigured(config, runConfig) : false;
    });

    const currentMaskMode = config.privacyFilter?.enabled && config.privacyFilter.mode === 'mask';
    const requiresMaskedExport = currentMaskMode || items.some(item => item.privacy?.mode === 'mask');
    const itemRequiresMaskedText = (item: BatchItem) => item.privacy?.mode === 'mask';
    const hasUnsafePrivacyState = (item: BatchItem) => {
        if (currentMaskMode && (!item.privacy || item.privacy.mode !== 'mask')) return true;
        if (item.privacy?.mode === 'mask' && item.privacy.runtime !== 'local-sidecar') return true;
        if (item.privacy?.masked && !item.maskedSourceText) return true;
        return false;
    };
    const getSafeSourceText = (item: BatchItem) => {
        if (itemRequiresMaskedText(item) && item.privacy?.masked) return item.maskedSourceText || '';
        return item.sourceText;
    };
    const getSafeReferenceSummary = (item: BatchItem) => {
        if (itemRequiresMaskedText(item) && item.privacy?.masked) return item.maskedReferenceSummary || item.referenceSummary;
        return item.referenceSummary;
    };
    const isSuccessfulOutput = (output?: string | null) => Boolean(output && output.trim() && !output.trim().startsWith('Error:'));
    const getPrivacyExport = (item: BatchItem) => item.privacy ? {
        masked: item.privacy.masked,
        mode: item.privacy.mode,
        runtime: item.privacy.runtime,
        countsByCategory: item.privacy.countsByCategory,
        originalLength: item.privacy.originalLength,
        filteredAt: item.privacy.filteredAt
    } : {
        masked: false,
        mode: 'off',
        runtime: 'unavailable',
        countsByCategory: {},
        originalLength: item.sourceText.length,
        filteredAt: null
    };
    const ensurePrivacyReadyForExport = () => {
        if (!requiresMaskedExport) return true;
        const unsafe = items.some(hasUnsafePrivacyState);
        if (unsafe) {
            alert('Privacy Filter export is blocked because some items are not safely masked. Run Privacy Filter scan or re-run the batch with mask mode enabled before exporting.');
            return false;
        }
        return true;
    };

    // Model Comparison Statistics
    const comparisonStats = useMemo(() => {
        const stats: Record<string, {
            configId: string;
            name: string;
            totalEvaluated: number;
            avgScore: number;
            scores: number[];
            wins: number;
            distribution: Record<string, number>;
            bestCount: number;
            worstCount: number;
            criteriaAvg: Record<string, number>;
        }> = {};

        // Initialize stats for each config
        config.activeRunConfigs.forEach(configId => {
            const runConfig = config.runConfigurations.find(c => c.id === configId);
            stats[configId] = {
                configId,
                name: runConfig?.name || configId,
                totalEvaluated: 0,
                avgScore: 0,
                scores: [],
                wins: 0,
                distribution: { '1-3': 0, '4-6': 0, '7-8': 0, '9-10': 0 },
                bestCount: 0,
                worstCount: 0,
                criteriaAvg: {}
            };
        });

        // Calculate per-item best/worst and aggregate scores
        items.forEach(item => {
            const itemScores: { configId: string; score: number }[] = [];

            config.activeRunConfigs.forEach(configId => {
                const evaluation = item.evaluations[configId];
                if (evaluation && typeof evaluation.score === 'number') {
                    const score = evaluation.score;
                    stats[configId].scores.push(score);
                    stats[configId].totalEvaluated++;
                    itemScores.push({ configId, score });

                    // Distribution buckets
                    if (score <= 3) stats[configId].distribution['1-3']++;
                    else if (score <= 6) stats[configId].distribution['4-6']++;
                    else if (score <= 8) stats[configId].distribution['7-8']++;
                    else stats[configId].distribution['9-10']++;

                    // Criteria averages
                    if (evaluation.criteriaScores) {
                        Object.entries(evaluation.criteriaScores).forEach(([criterion, critScore]) => {
                            if (!stats[configId].criteriaAvg[criterion]) {
                                stats[configId].criteriaAvg[criterion] = 0;
                            }
                            stats[configId].criteriaAvg[criterion] += critScore as number;
                        });
                    }
                }
            });

            // Determine winner for this item (highest score)
            if (itemScores.length > 1) {
                const sorted = [...itemScores].sort((a, b) => b.score - a.score);
                const best = sorted[0];
                const worst = sorted[sorted.length - 1];

                if (best.score > worst.score) {
                    stats[best.configId].wins++;
                    stats[best.configId].bestCount++;
                    stats[worst.configId].worstCount++;
                }
            }
        });

        // Calculate averages
        Object.keys(stats).forEach(configId => {
            const s = stats[configId];
            if (s.scores.length > 0) {
                s.avgScore = s.scores.reduce((a, b) => a + b, 0) / s.scores.length;
            }
            Object.keys(s.criteriaAvg).forEach(criterion => {
                if (s.totalEvaluated > 0) {
                    s.criteriaAvg[criterion] = s.criteriaAvg[criterion] / s.totalEvaluated;
                }
            });
        });

        return stats;
    }, [items, config.activeRunConfigs, config.runConfigurations]);

    // Initialize visible columns with all active run configs on mount/change
    // Initialize visible columns with all active run configs on mount/change, plus reference
    React.useEffect(() => {
        setVisibleColumns([...config.activeRunConfigs, 'reference']);
    }, [config.activeRunConfigs]);

    // Filter items by search term and validation status
    const filteredItems = useMemo(() => {
        return items.filter(item => {
            // Search filter
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                const matchesSearch =
                    (item.title && item.title.toLowerCase().includes(term)) ||
                    item.sourceText.toLowerCase().includes(term) ||
                    Object.values(item.results).some(r => r.toLowerCase().includes(term));
                if (!matchesSearch) return false;
            }

            // Validation status filter
            if (filterMode === 'all') return true;
            if (filterMode === 'pending') return !item.humanValidated || item.humanValidated === 'pending';
            if (filterMode === 'approved') return item.humanValidated === 'approved';
            if (filterMode === 'rejected') return item.humanValidated === 'rejected';
            if (filterMode === 'low-score') {
                // Low score = any evaluation with score < 7
                return Object.values(item.evaluations).some(e => e.score && e.score < 7);
            }
            return true;
        });
    }, [items, searchTerm, filterMode]);

    // Validate and clamp score between 1 and 10
    const validateScore = (value: number): number => {
        const num = parseInt(String(value));
        if (isNaN(num)) return 1;
        return Math.max(1, Math.min(10, num));
    };

    const toggleColumn = (id: string) => {
        setVisibleColumns(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
    };

    // LLM as a Judge
    const judgeWithLLM = async (itemId: string, configId: string) => {
        const item = items.find(i => i.id === itemId);
        const runConfig = config.runConfigurations.find(c => c.id === configId);

        if (!item || !runConfig) return;

        const output = item.results[configId];
        if (!output) {
            alert('No output to judge. Run the batch first.');
            return;
        }

        setJudgingItemId(itemId + '-' + configId);

        try {
            if (requiresMaskedExport && hasUnsafePrivacyState(item)) {
                alert('Run Privacy Filter scan or process the batch with mask mode enabled before judging this result.');
                return false;
            }

            const judgeRuntime = resolveJudgeRuntime(config, runConfig);

            // Pass reference summary if available
            const evaluation = await evaluateSummary(
                getSafeSourceText(item),
                output,
                config.judgeCriteria,
                judgeRuntime.provider,
                judgeRuntime.model,
                judgeRuntime.endpoint,
                judgeRuntime.apiKey,
                getSafeReferenceSummary(item)
            );

            // Update evaluation with all new fields
            onUpdateEvaluation(itemId, configId, 'score', evaluation.score);
            onUpdateEvaluation(itemId, configId, 'note', item.privacy?.masked ? `Privacy-filtered input. ${evaluation.note}` : evaluation.note);

            // Store new fields if present
            if (evaluation.criteriaScores) {
                onUpdateEvaluation(itemId, configId, 'criteriaScores', evaluation.criteriaScores);
            }
            if (evaluation.comparedToReference !== undefined) {
                onUpdateEvaluation(itemId, configId, 'comparedToReference', evaluation.comparedToReference);
            }

            return true; // Success
        } catch (error: any) {
            const errorMsg = error.message || 'Unknown error';
            onUpdateEvaluation(itemId, configId, 'note', `⚠️ Judge failed: ${errorMsg}`);
            if (!isBatchJudging) {
                alert(`Failed to get LLM judgment: ${errorMsg}`);
            }
            return false; // Failure
        } finally {
            setJudgingItemId(null);
        }
    };
    // Batch Judge - Judge all items with results
    const judgeAllItems = async () => {
        if (isBatchJudging) return;

        const itemsToJudge: Array<{ itemId: string; configId: string }> = [];
        items.forEach(item => {
            config.activeRunConfigs.forEach(configId => {
                const output = item.results[configId];
                if (output && !output.startsWith('Error:')) {
                    itemsToJudge.push({ itemId: item.id, configId });
                }
            });
        });

        if (itemsToJudge.length === 0) {
            alert('No results to judge. Please run the batch process first.');
            return;
        }

        const confirmed = confirm(`Judge all ${itemsToJudge.length} results? This will take some time.`);
        if (!confirmed) return;

        setIsBatchJudging(true);
        setBatchJudgeProgress({ current: 0, total: itemsToJudge.length });

        let successCount = 0;
        let failureCount = 0;

        for (let i = 0; i < itemsToJudge.length; i++) {
            const { itemId, configId } = itemsToJudge[i];
            setBatchJudgeProgress({ current: i + 1, total: itemsToJudge.length });

            const success = await judgeWithLLM(itemId, configId);
            if (success) successCount++;
            else failureCount++;

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        setIsBatchJudging(false);
        setBatchJudgeProgress({ current: 0, total: 0 });

        alert(`Batch judging complete!\n✓ Success: ${successCount}\n✗ Failed: ${failureCount}`);
    };

    const exportJSONL = () => {
        try {
            if (!ensurePrivacyReadyForExport()) return;
            // Prepare JSONL format for Gemini Fine-tuning
            const dataset = items.map(item => {
                // Find ground truth model or default to first/best available
                const gtModel = Object.keys(item.evaluations).find(m => item.evaluations[m].isGroundTruth);
                const output = gtModel ? item.results[gtModel] : null;

                if (!isSuccessfulOutput(output)) return null;

                return {
                    messages: [
                        { role: "system", content: config.systemInstruction },
                        { role: "user", content: getSafeSourceText(item) },
                        { role: "model", content: output }
                    ],
                    privacy: getPrivacyExport(item)
                };
            }).filter(Boolean);

            if (dataset.length === 0) {
                alert('No ground truth data to export. Please mark at least one response as ground truth.');
                return;
            }

            const jsonlContent = dataset.map(d => JSON.stringify(d)).join('\n');
            const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `finetune_dataset_${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
            document.body.appendChild(a);
            a.click();

            // Delay cleanup to ensure download starts
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);

        } catch (error) {
            alert('Failed to export JSONL file. Check console for details.');
        }
    };

    // Export for Reward Model Training (RL) - includes scores
    const exportRL = () => {
        try {
            if (!ensurePrivacyReadyForExport()) return;
            const dataset: any[] = [];

            items.forEach(item => {
                Object.keys(item.results).forEach(configId => {
                    const runConfig = config.runConfigurations.find(c => c.id === configId);
                    const evaluation = item.evaluations[configId];
                    const output = item.results[configId];

                    if (isSuccessfulOutput(output) && evaluation && typeof evaluation.score === 'number') {
                        dataset.push({
                            input: getSafeSourceText(item),
                            output: output,
                            score: evaluation.score,
                            reference: getSafeReferenceSummary(item) || null,
                            criteriaScores: evaluation.criteriaScores || null,
                            configName: runConfig?.name || configId,
                            comparedToReference: evaluation.comparedToReference || false,
                            privacy: getPrivacyExport(item)
                        });
                    }
                });
            });

            if (dataset.length === 0) {
                alert('No scored outputs to export for RL training.');
                return;
            }

            const jsonlContent = dataset.map(d => JSON.stringify(d)).join('\n');
            const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `rl_reward_dataset_${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);

        } catch (error) {
            alert('Failed to export RL dataset.');
        }
    };

    // Export for SFT - only approved/high-score outputs
    const exportSFT = (minScore: number = 7) => {
        try {
            if (!ensurePrivacyReadyForExport()) return;
            const dataset: any[] = [];

            items.forEach(item => {
                // Only include approved items OR high-scoring items with ground truth flag
                const validConfigs = Object.keys(item.results).filter(configId => {
                    const evaluation = item.evaluations[configId];
                    const isApproved = item.humanValidated === 'approved';
                    const isHighScore = evaluation && evaluation.score >= minScore;
                    const isGroundTruth = evaluation && evaluation.isGroundTruth;
                    return isApproved || isHighScore || isGroundTruth;
                });

                validConfigs.forEach(configId => {
                    const output = item.results[configId];
                    if (isSuccessfulOutput(output)) {
                        dataset.push({
                            messages: [
                                { role: "system", content: config.systemInstruction },
                                { role: "user", content: getSafeSourceText(item) },
                                { role: "assistant", content: output }
                            ],
                            privacy: getPrivacyExport(item)
                        });
                    }
                });
            });

            if (dataset.length === 0) {
                alert(`No outputs meeting SFT criteria (score >= ${minScore}, approved, or ground truth).`);
                return;
            }

            const jsonlContent = dataset.map(d => JSON.stringify(d)).join('\n');
            const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sft_dataset_${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);

        } catch (error) {
            alert('Failed to export SFT dataset.');
        }
    };

    // Export for DPO - chosen/rejected pairs from same source
    const exportDPO = () => {
        try {
            if (!ensurePrivacyReadyForExport()) return;
            const dataset: any[] = [];

            items.forEach(item => {
                const configScores = Object.keys(item.results)
                    .map(configId => ({
                        configId,
                        output: item.results[configId],
                        score: item.evaluations[configId]?.score || 0
                    }))
                    .filter(x => isSuccessfulOutput(x.output))
                    .sort((a, b) => b.score - a.score);

                // Need at least 2 different scores to create preference pair
                if (configScores.length >= 2 && configScores[0].score !== configScores[configScores.length - 1].score) {
                    const chosen = configScores[0];
                    const rejected = configScores[configScores.length - 1];

                    dataset.push({
                        prompt: getSafeSourceText(item),
                        chosen: chosen.output,
                        rejected: rejected.output,
                        chosen_score: chosen.score,
                        rejected_score: rejected.score,
                        reference: getSafeReferenceSummary(item) || null,
                        privacy: getPrivacyExport(item)
                    });
                }
            });

            if (dataset.length === 0) {
                alert('No valid preference pairs for DPO export. Need items with multiple configs and different scores.');
                return;
            }

            const jsonlContent = dataset.map(d => JSON.stringify(d)).join('\n');
            const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `dpo_preferences_${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);

        } catch (error) {
            alert('Failed to export DPO dataset.');
        }
    };

    const exportCSV = () => {
        try {
            if (!ensurePrivacyReadyForExport()) return;
            // Prepare CSV with comprehensive data
            const headers = ['ID', 'Title', 'Source Text', 'Privacy Masked', 'Privacy Counts'];

            // Add column for each active configuration
            config.activeRunConfigs.forEach(configId => {
                const runConfig = config.runConfigurations.find(c => c.id === configId);
                if (runConfig) {
                    headers.push(`${runConfig.name} - Output`);
                    headers.push(`${runConfig.name} - Score`);
                    headers.push(`${runConfig.name} - Ground Truth`);
                    headers.push(`${runConfig.name} - Notes`);
                }
            });

            // Escape CSV field
            const escapeCSV = (field: any): string => {
                if (field === null || field === undefined) return '';
                const str = String(field);
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            };

            // Build rows
            const rows = [headers.map(escapeCSV).join(',')];

            items.forEach((item, idx) => {
                const row = [
                    idx + 1,
                    escapeCSV(item.title || ''),
                    escapeCSV(getSafeSourceText(item)),
                    escapeCSV(item.privacy?.masked ? 'Yes' : 'No'),
                    escapeCSV(item.privacy ? JSON.stringify(item.privacy.countsByCategory) : '')
                ];

                config.activeRunConfigs.forEach(configId => {
                    const output = item.results[configId] || '';
                    const evaluation = item.evaluations[configId] || { score: '', note: '', isGroundTruth: false };

                    row.push(escapeCSV(output));
                    row.push(escapeCSV(evaluation.score || ''));
                    row.push(escapeCSV(evaluation.isGroundTruth ? 'Yes' : 'No'));
                    row.push(escapeCSV(evaluation.note || ''));
                });

                rows.push(row.join(','));
            });

            const csvContent = rows.join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `batch_results_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
            document.body.appendChild(a);
            a.click();

            // Delay cleanup to ensure download starts
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);

        } catch (error) {
            alert('Failed to export CSV file. Check console for details.');
        }
    };

    // Analyze Model consistency
    const modelStats = useMemo(() => {
        const stats: Record<string, { avgWords: number; adherence: number; isConsistent: boolean }> = {};
        const target = config.maxWords;
        // Tolerance: +/- 15% of target


        // Calculate stats for all active configs
        config.activeRunConfigs.forEach(configId => {
            const runConfig = config.runConfigurations.find(c => c.id === configId);
            if (!runConfig) return;

            let totalWords = 0;
            let count = 0;
            let onTargetCount = 0;

            items.forEach(item => {
                const result = item.results[configId];
                if (result && !result.startsWith('Error:')) {
                    const wordCount = result.trim().split(/\s+/).filter(Boolean).length;
                    totalWords += wordCount;
                    count++;

                    if (Math.abs(wordCount - runConfig.maxWords) <= (runConfig.maxWords * 0.15)) {
                        onTargetCount++;
                    }
                }
            });

            const avgWords = count > 0 ? Math.round(totalWords / count) : 0;
            const adherence = count > 0 ? (onTargetCount / count) : 0;

            // Mark consistent if > 50% of items are within tolerance range
            const isConsistent = count > 0 && adherence >= 0.5;

            stats[configId] = { avgWords, adherence, isConsistent };
        });
        return stats;
    }, [items, config.activeRunConfigs, config.runConfigurations]);

    const sortedConfigs = useMemo(() => {
        const activeConfigs = config.runConfigurations.filter(c => config.activeRunConfigs.includes(c.id));

        if (sortCriteria === 'default') return activeConfigs;

        return [...activeConfigs].sort((a, b) => {
            // Use ID for stats lookup
            const statsA = modelStats[a.id];
            const statsB = modelStats[b.id];
            return (statsB?.adherence || 0) - (statsA?.adherence || 0);
        });
    }, [config.runConfigurations, config.activeRunConfigs, modelStats, sortCriteria]);

    if (items.length === 0) {
        return (
            <div className="flex flex-col h-full p-6 items-center justify-center text-slate-600">
                <div className="w-16 h-16 bg-slate-900 rounded-full flex items-center justify-center mb-4">
                    <MessageSquare size={32} className="opacity-50" />
                </div>
                <p className="text-sm font-medium">Batch Results Workbench</p>
                <p className="text-xs mt-2 text-slate-700 text-center max-w-sm">
                    Run a batch to populate this table. You can then grade models, add notes, and export a fine-tuning dataset.
                </p>
            </div>
        );
    }



    return (
        <div className="flex flex-col h-full bg-slate-950">
            {/* Header */}
            <div className="p-4 border-b border-slate-800 bg-slate-950">
                <div className="flex flex-wrap gap-3 items-center">
                    <div className="flex-shrink-0">
                        <h2 className="text-lg font-semibold text-slate-100">{t('results.title')}</h2>
                        <p className="text-xs text-slate-500">
                            {filteredItems.length !== items.length ? (
                                <span className="text-indigo-400 font-medium">{filteredItems.length} {t('results.matching')}</span>
                            ) : (
                                <span>{items.length} {t('results.testCases')}</span>
                            )}
                            {' '}• {config.activeRunConfigs.length} {t('common.modelsActive')}
                        </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
                        {/* Column Visibility Toggle */}
                        <div className="relative group">
                            <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 transition-colors">
                                <Settings size={14} />
                                <span className="hidden sm:inline">{t('common.columns')}</span>
                            </button>
                            <div className="absolute right-0 top-full mt-2 w-48 bg-slate-900 border border-slate-800 rounded-lg shadow-xl p-2 hidden group-hover:block z-50">
                                <div className="text-[10px] uppercase font-bold text-slate-500 mb-2 px-1">{t('results.toggleVisibility')}</div>
                                <button
                                    onClick={() => toggleColumn('reference')}
                                    className="w-full text-left px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800 rounded flex items-center justify-between"
                                >
                                    <span className="truncate">{t('results.reference')}</span>
                                    {visibleColumns.includes('reference') && <Check size={12} className="text-emerald-400" />}
                                </button>
                                {config.runConfigurations.filter(c => config.activeRunConfigs.includes(c.id)).map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => toggleColumn(c.id)}
                                        className="w-full text-left px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800 rounded flex items-center justify-between"
                                    >
                                        <span className="truncate">{c.name}</span>
                                        {visibleColumns.includes(c.id) && <Check size={12} className="text-emerald-400" />}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="relative group flex-1 sm:flex-none">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" size={14} />
                            <input
                                type="text"
                                placeholder={t('common.search')}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full sm:w-48 focus:w-full sm:focus:w-64 bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-lg pl-8 pr-8 py-2 focus:ring-1 focus:ring-indigo-500 outline-none transition-all placeholder-slate-600"
                            />
                            {searchTerm && (
                                <button
                                    onClick={() => setSearchTerm('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>

                        <button
                            onClick={() => setSortCriteria(prev => prev === 'default' ? 'consistency' : 'default')}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${sortCriteria === 'consistency'
                                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                                }`}
                            title="Sort columns by adherence to word count target"
                        >
                            <ArrowUpDown size={14} />
                            <span className="hidden sm:inline">{sortCriteria === 'consistency' ? t('results.bestAdherence') : t('results.defaultOrder')}</span>
                        </button>

                        {/* Model Comparison Toggle */}
                        <button
                            onClick={() => setShowComparison(prev => !prev)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${showComparison
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                                }`}
                            title="Show model comparison dashboard"
                        >
                            <Star size={14} />
                            <span className="hidden sm:inline">{t('common.compare')}</span>
                        </button>

                        {/* Filter Dropdown */}
                        <div className="relative group">
                            <button className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${filterMode !== 'all'
                                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                                }`}>
                                <Filter size={14} />
                                <span className="hidden sm:inline">{
                                    filterMode === 'all' ? t('results.all') :
                                        filterMode === 'pending' ? t('results.pending') :
                                            filterMode === 'approved' ? t('results.approved') :
                                                filterMode === 'rejected' ? t('results.rejected') :
                                                    t('results.lowScore')
                                }</span>
                            </button>
                            <div className="absolute right-0 top-full mt-2 w-36 bg-slate-900 border border-slate-700 rounded-lg shadow-xl hidden group-hover:block z-50">
                                {(['all', 'pending', 'approved', 'rejected', 'low-score'] as const).map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => setFilterMode(mode)}
                                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between ${filterMode === mode
                                            ? 'bg-cyan-500/20 text-cyan-300'
                                            : 'text-slate-300 hover:bg-slate-800'
                                            }`}
                                    >
                                        {mode === 'all' ? 'All Items' :
                                            mode === 'pending' ? '⏳ Pending' :
                                                mode === 'approved' ? '✅ Approved' :
                                                    mode === 'rejected' ? '❌ Rejected' :
                                                        '⚠️ Low Score (<7)'}
                                        {filterMode === mode && <Check size={12} />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* Batch Judge Button */}
                            <button
                                onClick={judgeAllItems}
                                disabled={!isAnyJudgeConfigured || isBatchJudging || items.length === 0}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors border whitespace-nowrap ${!isAnyJudgeConfigured
                                    ? 'bg-slate-800/50 text-slate-500 border-slate-700 cursor-not-allowed'
                                    : isBatchJudging
                                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/30 cursor-wait'
                                        : 'bg-slate-800 hover:bg-slate-700 text-purple-300 border-slate-700'
                                    }`}
                                title={!isAnyJudgeConfigured ? 'Configure judge endpoint and model in Settings first' : 'Use LLM to judge all results automatically'}
                            >
                                {isBatchJudging ? (
                                    <>
                                        <div className="w-3.5 h-3.5 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                                        <span className="hidden sm:inline">
                                            Judging {batchJudgeProgress.current}/{batchJudgeProgress.total}
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <Target size={14} />
                                        <span className="hidden sm:inline">{t('results.judgeBatch')}</span>
                                    </>
                                )}
                            </button>

                            <button
                                onClick={exportJSONL}
                                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-indigo-300 px-3 py-2 rounded-lg text-xs font-medium transition-colors border border-slate-700 whitespace-nowrap"
                                title="Export as JSONL for fine-tuning (ground truth only)"
                            >
                                <FileJson size={14} />
                                <span className="hidden sm:inline">JSONL</span>
                            </button>

                            {/* Training Dataset Export Dropdown */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowTrainingMenu(!showTrainingMenu)}
                                    className="flex items-center gap-2 bg-gradient-to-r from-purple-600/20 to-indigo-600/20 hover:from-purple-500/30 hover:to-indigo-500/30 text-purple-300 px-3 py-2 rounded-lg text-xs font-medium transition-colors border border-purple-500/30 whitespace-nowrap"
                                >
                                    <BookOpen size={14} />
                                    <span className="hidden sm:inline">Training</span>
                                    <ChevronDown size={12} className={`transition-transform ${showTrainingMenu ? 'rotate-180' : ''}`} />
                                </button>
                                {showTrainingMenu && (
                                    <>
                                        <div
                                            className="fixed inset-0 z-40"
                                            onClick={() => setShowTrainingMenu(false)}
                                        />
                                        <div className="absolute right-0 top-full mt-2 w-52 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50">
                                            <div className="text-[10px] uppercase font-bold text-slate-500 px-3 py-2 border-b border-slate-800">
                                                Export for Training
                                            </div>
                                            <button
                                                onClick={() => { exportRL(); setShowTrainingMenu(false); }}
                                                className="w-full text-left px-3 py-2.5 text-xs text-slate-300 hover:bg-purple-500/10 flex items-center gap-2 border-b border-slate-800"
                                            >
                                                <span className="w-5 h-5 rounded bg-orange-500/20 text-orange-400 flex items-center justify-center text-[10px] font-bold">RL</span>
                                                <div>
                                                    <div className="font-medium">Reward Model</div>
                                                    <div className="text-[10px] text-slate-500">All outputs with scores</div>
                                                </div>
                                            </button>
                                            <button
                                                onClick={() => { exportSFT(7); setShowTrainingMenu(false); }}
                                                className="w-full text-left px-3 py-2.5 text-xs text-slate-300 hover:bg-purple-500/10 flex items-center gap-2 border-b border-slate-800"
                                            >
                                                <span className="w-5 h-5 rounded bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-bold">SFT</span>
                                                <div>
                                                    <div className="font-medium">Supervised Fine-tuning</div>
                                                    <div className="text-[10px] text-slate-500">Approved ≥7 only</div>
                                                </div>
                                            </button>
                                            <button
                                                onClick={() => { exportDPO(); setShowTrainingMenu(false); }}
                                                className="w-full text-left px-3 py-2.5 text-xs text-slate-300 hover:bg-purple-500/10 flex items-center gap-2"
                                            >
                                                <span className="w-5 h-5 rounded bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold">DPO</span>
                                                <div>
                                                    <div className="font-medium">Preference Pairs</div>
                                                    <div className="text-[10px] text-slate-500">Best vs worst pairs</div>
                                                </div>
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>

                            <button
                                onClick={exportCSV}
                                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 px-3 py-2 rounded-lg text-xs font-medium transition-colors border border-slate-700 whitespace-nowrap"
                                title="Export all data as CSV spreadsheet"
                            >
                                <Download size={14} />
                                <span className="hidden sm:inline">CSV</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Model Comparison Dashboard */}
            {showComparison && (
                <div className="border-b border-slate-800 bg-slate-900/50 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                            <Star size={14} className="text-amber-400" />
                            Model Comparison Dashboard
                        </h3>
                        <span className="text-[10px] text-slate-500">
                            {Object.values(comparisonStats).reduce((a, s) => a + s.totalEvaluated, 0)} total evaluations
                        </span>
                    </div>

                    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(config.activeRunConfigs.length, 4)}, 1fr)` }}>
                        {Object.values(comparisonStats)
                            .sort((a, b) => b.avgScore - a.avgScore)
                            .map((stat, idx) => {
                                const isLeader = idx === 0 && stat.avgScore > 0;
                                const isLast = idx === Object.values(comparisonStats).length - 1 && stat.avgScore > 0;

                                return (
                                    <div
                                        key={stat.configId}
                                        className={`relative rounded-lg border p-3 ${isLeader
                                            ? 'border-amber-500/50 bg-amber-500/5'
                                            : isLast
                                                ? 'border-red-500/30 bg-red-500/5'
                                                : 'border-slate-700 bg-slate-800/50'
                                            }`}
                                    >
                                        {/* Rank Badge */}
                                        {idx < 3 && stat.avgScore > 0 && (
                                            <div className={`absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${idx === 0 ? 'bg-amber-500 text-amber-950' :
                                                idx === 1 ? 'bg-slate-400 text-slate-900' :
                                                    'bg-orange-600 text-orange-100'
                                                }`}>
                                                #{idx + 1}
                                            </div>
                                        )}

                                        {/* Model Name */}
                                        <div className="text-xs font-medium text-slate-200 truncate mb-2">{stat.name}</div>

                                        {/* Stats Grid */}
                                        <div className="grid grid-cols-2 gap-2 mb-2">
                                            <div className="text-center">
                                                <div className={`text-xl font-bold ${stat.avgScore >= 8 ? 'text-emerald-400' :
                                                    stat.avgScore >= 6 ? 'text-amber-400' :
                                                        stat.avgScore > 0 ? 'text-red-400' : 'text-slate-500'
                                                    }`}>
                                                    {stat.avgScore > 0 ? stat.avgScore.toFixed(1) : '—'}
                                                </div>
                                                <div className="text-[9px] text-slate-500 uppercase">Avg Score</div>
                                            </div>
                                            <div className="text-center">
                                                <div className="text-xl font-bold text-indigo-400">
                                                    {stat.totalEvaluated > 0 ? Math.round((stat.wins / stat.totalEvaluated) * 100) : 0}%
                                                </div>
                                                <div className="text-[9px] text-slate-500 uppercase">Win Rate</div>
                                            </div>
                                        </div>

                                        {/* Score Distribution Bar */}
                                        <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-700 mb-2">
                                            {stat.totalEvaluated > 0 && (
                                                <>
                                                    <div
                                                        className="bg-red-500"
                                                        style={{ width: `${(stat.distribution['1-3'] / stat.totalEvaluated) * 100}%` }}
                                                        title={`1-3: ${stat.distribution['1-3']}`}
                                                    />
                                                    <div
                                                        className="bg-amber-500"
                                                        style={{ width: `${(stat.distribution['4-6'] / stat.totalEvaluated) * 100}%` }}
                                                        title={`4-6: ${stat.distribution['4-6']}`}
                                                    />
                                                    <div
                                                        className="bg-emerald-400"
                                                        style={{ width: `${(stat.distribution['7-8'] / stat.totalEvaluated) * 100}%` }}
                                                        title={`7-8: ${stat.distribution['7-8']}`}
                                                    />
                                                    <div
                                                        className="bg-emerald-500"
                                                        style={{ width: `${(stat.distribution['9-10'] / stat.totalEvaluated) * 100}%` }}
                                                        title={`9-10: ${stat.distribution['9-10']}`}
                                                    />
                                                </>
                                            )}
                                        </div>

                                        {/* Best/Worst Counts */}
                                        <div className="flex justify-between text-[10px]">
                                            <span className="text-emerald-400">
                                                <ThumbsUp size={10} className="inline mr-0.5" />
                                                {stat.bestCount} best
                                            </span>
                                            <span className="text-slate-500">{stat.totalEvaluated} eval</span>
                                            <span className="text-red-400">
                                                {stat.worstCount} worst
                                                <ThumbsDown size={10} className="inline ml-0.5" />
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                </div>
            )}

            {/* Table Container */}
            <div className="flex-1 overflow-hidden p-4">
                <div className="h-full overflow-auto border border-slate-800 rounded-lg" style={{ scrollbarColor: '#475569 #1e293b', scrollbarWidth: 'thin' }}>
                    <table className="min-w-full divide-y divide-slate-800">
                        <thead className="bg-slate-900 sticky top-0 z-10">
                            <tr>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider w-10">#</th>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider w-64">Task / Source</th>
                                {visibleColumns.includes('reference') && (
                                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider w-64 bg-slate-900 border-l border-slate-800">
                                        Reference / Master
                                    </th>
                                )}
                                {sortedConfigs.filter(c => visibleColumns.includes(c.id)).map(conf => {
                                    const stats = modelStats[conf.id];
                                    return (
                                        <th key={conf.id} scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider min-w-[300px]">
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    <span className={stats?.isConsistent ? "text-indigo-300" : ""}>{conf.name}</span>
                                                    {stats?.isConsistent && (
                                                        <div className="group relative">
                                                            <Target size={14} className="text-emerald-400 cursor-help" />
                                                            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block bg-slate-800 text-xs text-white px-2 py-1 rounded border border-slate-700 shadow-xl whitespace-nowrap z-50 pointer-events-none">
                                                                Consistently close to {conf.maxWords} words
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 text-[10px] normal-case tracking-normal font-mono text-slate-500">
                                                    <span>{conf.model}</span>
                                                    <span className="opacity-30">|</span>
                                                    <span>Avg: {stats?.avgWords || 0}w</span>
                                                </div>
                                            </div>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody className="bg-slate-950 divide-y divide-slate-800">
                            {filteredItems.length > 0 ? (
                                filteredItems.map((item, idx) => (
                                    <React.Fragment key={item.id}>
                                        {/* Summary Row */}
                                        <tr className={`hover:bg-slate-900/50 transition-colors ${expandedRow === item.id ? 'bg-slate-900/30' : ''}`}>
                                            <td className="px-4 py-4 whitespace-nowrap text-xs text-slate-500 font-mono">
                                                <button onClick={() => setExpandedRow(expandedRow === item.id ? null : item.id)}>
                                                    {expandedRow === item.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                </button>
                                            </td>
                                            <td className="px-4 py-4 text-sm text-slate-300 align-top cursor-pointer" onClick={() => setExpandedRow(expandedRow === item.id ? null : item.id)}>
                                                {item.title && (
                                                    <div className="font-bold text-slate-200 text-xs mb-1">{item.title}</div>
                                                )}
                                                <div className="line-clamp-3 font-mono text-xs text-slate-400">
                                                    {item.sourceText}
                                                </div>
                                                <div className={`mt-2 text-[10px] uppercase font-bold ${item.status === 'done' ? 'text-emerald-500' : 'text-amber-500'}`}>
                                                    {item.status}
                                                </div>
                                                {item.privacy && item.privacy.mode !== 'off' && (
                                                    <div className={`mt-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${item.privacy.masked
                                                        ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300'
                                                        : 'border-slate-600 bg-slate-800 text-slate-400'
                                                        }`}>
                                                        {item.privacy.masked ? 'Privacy filtered' : 'Privacy scanned'}
                                                    </div>
                                                )}
                                            </td>
                                            {visibleColumns.includes('reference') && (
                                                <td className="px-4 py-4 text-sm text-slate-300 align-top border-l border-slate-800 bg-slate-900/30">
                                                    <div className="text-xs font-mono text-slate-400 whitespace-pre-wrap max-h-[150px] overflow-y-auto custom-scrollbar">
                                                        {item.referenceSummary || <span className="text-slate-600 italic">No reference provided</span>}
                                                    </div>
                                                </td>
                                            )}
                                            {sortedConfigs.filter(c => visibleColumns.includes(c.id)).map(conf => {
                                                const output = item.results[conf.id];
                                                const evalData = item.evaluations[conf.id] || { score: 0, note: '', isGroundTruth: false };
                                                const isJudgeConfigured = isJudgeRuntimeConfigured(config, conf);

                                                return (
                                                    <td key={conf.id} className="px-4 py-4 align-top border-l border-slate-800/50">
                                                        {output ? (
                                                            <div className="flex flex-col gap-2 h-full">
                                                                <div className="text-xs text-slate-300 line-clamp-4 mb-2 prose prose-invert prose-xs max-w-none">
                                                                    {output.startsWith('Error:') ? <span className="text-red-400">{output}</span> : output}
                                                                </div>

                                                                {/* Grading Controls Mini */}
                                                                <div className="mt-auto flex items-center justify-between bg-slate-900/50 p-1.5 rounded border border-slate-800">
                                                                    <div className="flex items-center gap-1">
                                                                        <span className="text-[10px] text-slate-500 uppercase font-bold">Grade:</span>
                                                                        <input
                                                                            type="number"
                                                                            min="1" max="10"
                                                                            value={evalData.score || ''}
                                                                            onChange={(e) => onUpdateEvaluation(item.id, conf.id, 'score', validateScore(parseInt(e.target.value)))}
                                                                            className="w-10 bg-slate-800 border border-slate-700 text-center text-xs rounded focus:ring-1 focus:ring-indigo-500"
                                                                        />
                                                                    </div>
                                                                    <div className="flex items-center gap-1">
                                                                        <button
                                                                            onClick={() => judgeWithLLM(item.id, conf.id)}
                                                                            disabled={!isJudgeConfigured || judgingItemId === item.id + '-' + conf.id}
                                                                            className={`p-1 rounded transition-colors ${!isJudgeConfigured ? 'text-slate-600 cursor-not-allowed' : 'text-purple-400 hover:text-purple-300 hover:bg-purple-500/10'} disabled:opacity-50`}
                                                                            title={!isJudgeConfigured ? 'Configure judge in Settings first' : 'Use LLM Judge'}
                                                                        >
                                                                            {judgingItemId === item.id + '-' + conf.id ? (
                                                                                <div className="w-3.5 h-3.5 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                                                                            ) : (
                                                                                <Target size={14} />
                                                                            )}
                                                                        </button>
                                                                        <button
                                                                            onClick={() => onUpdateEvaluation(item.id, conf.id, 'isGroundTruth', !evalData.isGroundTruth)}
                                                                            className={`p-1 rounded transition-colors ${evalData.isGroundTruth ? 'text-yellow-400 bg-yellow-400/10' : 'text-slate-600 hover:text-slate-400'}`}
                                                                            title="Mark as Ground Truth (Best Response)"
                                                                        >
                                                                            <Star size={14} fill={evalData.isGroundTruth ? "currentColor" : "none"} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="h-full flex items-center justify-center">
                                                                <span className="w-2 h-2 bg-slate-700 rounded-full animate-pulse"></span>
                                                            </div>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                        {/* Expanded Detail Row */}
                                        {
                                            expandedRow === item.id && (
                                                <tr className="bg-slate-900/20">
                                                    <td colSpan={2 + sortedConfigs.filter(c => visibleColumns.includes(c.id)).length} className="px-4 py-4">
                                                        <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                                                            <div className="mb-4">
                                                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Full Source Text</h4>
                                                                {item.title && <h5 className="text-sm font-bold text-slate-300 mb-1">{item.title}</h5>}
                                                                <div className="bg-slate-900 p-3 rounded text-sm text-slate-300 font-mono whitespace-pre-wrap border border-slate-800">
                                                                    {item.sourceText}
                                                                </div>
                                                            </div>

                                                            {item.privacy && item.privacy.mode !== 'off' && (
                                                                <div className="mb-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <h4 className="text-xs font-bold text-cyan-300 uppercase">Privacy Filter</h4>
                                                                        <span className="text-[10px] text-cyan-100/70">
                                                                            This reduces exposure; it is not legal anonymization.
                                                                        </span>
                                                                    </div>
                                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                                        {Object.entries(item.privacy.countsByCategory).filter(([, count]) => count > 0).map(([label, count]) => (
                                                                            <span key={label} className="rounded border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-100">
                                                                                {label}: {count}
                                                                            </span>
                                                                        ))}
                                                                        {Object.values(item.privacy.countsByCategory).every(count => count === 0) && (
                                                                            <span className="text-[10px] text-slate-400">No spans detected.</span>
                                                                        )}
                                                                    </div>
                                                                    {item.maskedSourceText && (
                                                                        <div className="mt-3">
                                                                            <div className="text-[10px] font-bold uppercase text-cyan-300 mb-1">Masked text sent to LLM</div>
                                                                            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-950 p-2 font-mono text-xs text-slate-300">
                                                                                {item.maskedSourceText}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}

                                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                                                {sortedConfigs.filter(c => visibleColumns.includes(c.id)).map(conf => {
                                                                    const evalData = item.evaluations[conf.id] || { score: 0, note: '', isGroundTruth: false };
                                                                    return (
                                                                        <div key={conf.id} className={`border rounded-lg p-4 ${evalData.isGroundTruth ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-slate-800 bg-slate-900/50'}`}>
                                                                            <div className="flex justify-between items-center mb-3 border-b border-slate-800 pb-2">
                                                                                <div>
                                                                                    <span className="text-sm font-bold text-indigo-300 block">{conf.name}</span>
                                                                                    <span className="text-[10px] text-slate-500 font-mono">{conf.model}</span>
                                                                                </div>
                                                                                <div className="flex items-center gap-2">
                                                                                    {evalData.isGroundTruth && <span className="text-[10px] bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded border border-yellow-500/30">GROUND TRUTH</span>}
                                                                                    <button
                                                                                        onClick={() => onUpdateEvaluation(item.id, conf.id, 'isGroundTruth', !evalData.isGroundTruth)}
                                                                                        className={`p-1 rounded transition-colors ${evalData.isGroundTruth ? 'text-yellow-400 bg-yellow-400/10' : 'text-slate-600 hover:text-slate-400'}`}
                                                                                        title={evalData.isGroundTruth ? "Unmark Ground Truth" : "Mark as Ground Truth"}
                                                                                    >
                                                                                        <Star size={16} fill={evalData.isGroundTruth ? "currentColor" : "none"} />
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                            <div className="prose prose-invert prose-sm max-w-none mb-4">
                                                                                <ReactMarkdown>{item.results[conf.id] || ''}</ReactMarkdown>
                                                                            </div>

                                                                            <div className="space-y-2 pt-3 border-t border-slate-800/50">
                                                                                <div className="flex gap-4">
                                                                                    <div className="flex-1">
                                                                                        <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Evaluator Score (1-10)</label>
                                                                                        <input
                                                                                            type="range" min="1" max="10"
                                                                                            value={evalData.score || 1}
                                                                                            onChange={(e) => onUpdateEvaluation(item.id, conf.id, 'score', validateScore(parseInt(e.target.value)))}
                                                                                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                                                        />
                                                                                        <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                                                                                            <span>1</span>
                                                                                            <span className="text-indigo-300 font-bold text-sm">{evalData.score || '-'}</span>
                                                                                            <span>10</span>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                                <div>
                                                                                    <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Notes / Corrections</label>
                                                                                    <textarea
                                                                                        value={evalData.note || ''}
                                                                                        onChange={(e) => onUpdateEvaluation(item.id, conf.id, 'note', e.target.value)}
                                                                                        placeholder="Add comments or improved phrasing..."
                                                                                        className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-xs text-slate-300 focus:ring-1 focus:ring-indigo-500 min-h-[60px]"
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )
                                        }
                                    </React.Fragment>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={2 + config.activeRunConfigs.length} className="px-4 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <Search size={24} className="opacity-20" />
                                            <p className="text-sm">No items found matching "{searchTerm}"</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default BatchResults;
