import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppConfig, RunConfiguration, DEFAULT_MODEL_OPTIONS, ToneType, FormatType } from '../types';
import { Plus, Trash2, Copy, Settings, Check, X, ChevronDown, ChevronUp, Sliders } from 'lucide-react';

interface RunConfigPanelProps {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    fetchedModels?: string[];
    onRefreshModels?: () => void;
}

const RunConfigPanel: React.FC<RunConfigPanelProps> = ({ config, setConfig, fetchedModels = [], onRefreshModels }) => {
    const { t } = useTranslation();
    const [editingId, setEditingId] = useState<string | null>(null);

    // ... existing functions ...

    const createNewConfig = () => {
        // ... (keep implementation)
        const newConfig: RunConfiguration = {
            id: crypto.randomUUID(),
            name: `${t('runConfig.name')} ${config.runConfigurations.length + 1}`,
            provider: config.provider,
            model: config.activeModels[0] || DEFAULT_MODEL_OPTIONS[0],
            systemInstruction: config.systemInstruction,
            temperature: config.temperature,
            topK: config.topK,
            topP: config.topP,
            maxOutputTokens: config.maxOutputTokens,
            tone: config.tone,
            format: config.format,
            customFocus: config.customFocus,
            maxWords: config.maxWords
        };

        setConfig(prev => ({
            ...prev,
            runConfigurations: [...prev.runConfigurations, newConfig],
            activeRunConfigs: [...prev.activeRunConfigs, newConfig.id]
        }));
        setEditingId(newConfig.id);
    };

    const updateConfig = (id: string, updates: Partial<RunConfiguration>) => {
        setConfig(prev => ({
            ...prev,
            runConfigurations: prev.runConfigurations.map(c =>
                c.id === id ? { ...c, ...updates } : c
            )
        }));
    };

    // Helper to determine provider based on model name
    const handleModelChange = (id: string, newModel: string) => {
        let newProvider = config.provider;
        updateConfig(id, { model: newModel, provider: newProvider });
    };

    const deleteConfig = (id: string) => {
        if (confirm(t('runConfig.deleteConfirm'))) {
            setConfig(prev => ({
                ...prev,
                runConfigurations: prev.runConfigurations.filter(c => c.id !== id),
                activeRunConfigs: prev.activeRunConfigs.filter(cid => cid !== id)
            }));
        }
    };

    const duplicateConfig = (conf: RunConfiguration) => {
        const newConf = { ...conf, id: crypto.randomUUID(), name: `${conf.name} (Copy)` };
        setConfig(prev => ({
            ...prev,
            runConfigurations: [...prev.runConfigurations, newConf],
            activeRunConfigs: [...prev.activeRunConfigs, newConf.id]
        }));
    };

    const toggleActive = (id: string) => {
        setConfig(prev => {
            const isActive = prev.activeRunConfigs.includes(id);
            return {
                ...prev,
                activeRunConfigs: isActive
                    ? prev.activeRunConfigs.filter(cid => cid !== id)
                    : [...prev.activeRunConfigs, id]
            };
        });
    };


    return (
        <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Sliders size={16} className="text-indigo-400" />
                    {t('runConfig.title')}
                </h3>
                <button
                    onClick={createNewConfig}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white p-1.5 rounded-md transition-colors"
                    title={t('runConfig.add')}
                >
                    <Plus size={16} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {config.runConfigurations.length === 0 ? (
                    <div className="text-center text-slate-500 py-8 text-xs">
                        <p>No configurations defined.</p>
                        <button onClick={createNewConfig} className="text-indigo-400 hover:underline mt-2">Create one</button>
                    </div>
                ) : (
                    config.runConfigurations.map(conf => (
                        <div key={conf.id} className={`border rounded-lg transition-all ${config.activeRunConfigs.includes(conf.id) ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-slate-800 bg-slate-900'}`}>

                            {/* Header / Summary */}
                            <div className="p-3 flex items-center gap-3">
                                <button
                                    onClick={() => toggleActive(conf.id)}
                                    className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${config.activeRunConfigs.includes(conf.id) ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-600 hover:border-slate-400'}`}
                                >
                                    {config.activeRunConfigs.includes(conf.id) && <Check size={12} />}
                                </button>

                                <div className="flex-1 min-w-0" onClick={() => setEditingId(editingId === conf.id ? null : conf.id)}>
                                    <div className="flex justify-between items-center cursor-pointer">
                                        <h3 className="text-sm font-bold text-slate-200 truncate">{conf.name}</h3>
                                        {editingId === conf.id ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
                                    </div>
                                    <div className="text-[10px] text-slate-500 truncate font-mono mt-0.5">
                                        {conf.model} • {t(`types.tone.${conf.tone}`)} • T:{conf.temperature}
                                    </div>
                                </div>

                                <div className="flex items-center gap-1">
                                    <button onClick={() => duplicateConfig(conf)} className="p-1.5 text-slate-500 hover:text-indigo-300 transition-colors" title="Duplicate">
                                        <Copy size={14} />
                                    </button>
                                    <button onClick={() => deleteConfig(conf.id)} className="p-1.5 text-slate-500 hover:text-red-400 transition-colors" title="Delete">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Editor */}
                            {editingId === conf.id && (
                                <div className="p-3 border-t border-slate-800/50 bg-slate-950/30 space-y-3 animate-in slide-in-from-top-2 duration-200">

                                    {/* Name */}
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">{t('runConfig.name')}</label>
                                        <input
                                            type="text"
                                            value={conf.name}
                                            onChange={(e) => updateConfig(conf.id, { name: e.target.value })}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none"
                                        />
                                    </div>

                                    {/* Model */}
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-[10px] uppercase font-bold text-slate-500">{t('common.model')}</label>
                                            {onRefreshModels && (
                                                <button
                                                    onClick={(e) => { e.preventDefault(); onRefreshModels(); }}
                                                    className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                                                    title="Refresh Models"
                                                >
                                                    Refresh
                                                </button>
                                            )}
                                        </div>
                                        <select
                                            value={conf.model}
                                            onChange={(e) => handleModelChange(conf.id, e.target.value)}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none"
                                        >
                                            <optgroup label="Available Models">
                                                {fetchedModels.map(m => <option key={m} value={m}>{m}</option>)}
                                                {!fetchedModels.length && DEFAULT_MODEL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                                            </optgroup>
                                            {/* Fallback for custom/manual entries */}
                                            {!fetchedModels.includes(conf.model) && !DEFAULT_MODEL_OPTIONS.includes(conf.model as any) && (
                                                <option value={conf.model}>{conf.model}</option>
                                            )}
                                        </select>
                                    </div>

                                    {/* System Instruction */}
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-[10px] uppercase font-bold text-slate-500">{t('runConfig.systemInstruction')}</label>
                                        </div>
                                        <textarea
                                            value={conf.systemInstruction}
                                            onChange={(e) => updateConfig(conf.id, { systemInstruction: e.target.value })}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none h-16 resize-none"
                                        />
                                    </div>


                                    {/* Params Grid */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">{t('runConfig.temperature')}</label>
                                            <input
                                                type="number"
                                                step="0.1"
                                                min="0"
                                                max="2"
                                                value={conf.temperature}
                                                onChange={(e) => updateConfig(conf.id, { temperature: parseFloat(e.target.value) })}
                                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">{t('sidebar.tone')}</label>
                                            <select
                                                value={conf.tone}
                                                onChange={(e) => updateConfig(conf.id, { tone: e.target.value as ToneType })}
                                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                                            >
                                                {Object.values(ToneType).map(tone => <option key={tone} value={tone}>{t(`types.tone.${tone}`)}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Max Words */}
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">{t('sidebar.maxWords')}</label>
                                        <input
                                            type="number"
                                            min="10"
                                            max="5000"
                                            value={conf.maxWords}
                                            onChange={(e) => updateConfig(conf.id, { maxWords: parseInt(e.target.value) || 100 })}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none"
                                            placeholder="e.g., 100"
                                        />
                                        <p className="text-[9px] text-slate-600 mt-0.5">Target word count for summaries</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default RunConfigPanel;
