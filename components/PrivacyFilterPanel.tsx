import React, { useState } from 'react';
import { AppConfig, PrivacyCategory, PrivacyMode } from '../types';
import { checkPrivacyRuntime, DEFAULT_PRIVACY_CATEGORIES, PRIVACY_CATEGORIES, PrivacyRuntimeStatus } from '../services/privacyFilterService';
import { AlertCircle, Check, RefreshCw, ShieldCheck } from 'lucide-react';

interface PrivacyFilterPanelProps {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    compact?: boolean;
}

const SENSITIVITY = [
    { label: 'High recall', value: 0.3 },
    { label: 'Balanced', value: 0.5 },
    { label: 'High precision', value: 0.75 }
];

const labelFor = (category: PrivacyCategory) => category.replace(/_/g, ' ');

const PrivacyFilterPanel: React.FC<PrivacyFilterPanelProps> = ({ config, setConfig, compact = false }) => {
    const [status, setStatus] = useState<PrivacyRuntimeStatus | null>(null);
    const [checking, setChecking] = useState(false);
    const privacy = config.privacyFilter;

    const updatePrivacy = (updates: Partial<AppConfig['privacyFilter']>) => {
        setConfig(prev => ({
            ...prev,
            privacyFilter: {
                ...prev.privacyFilter,
                ...updates,
                categories: {
                    ...DEFAULT_PRIVACY_CATEGORIES,
                    ...prev.privacyFilter.categories,
                    ...(updates.categories || {})
                }
            }
        }));
    };

    const setMode = (mode: PrivacyMode) => {
        updatePrivacy({
            mode,
            enabled: mode !== 'off'
        });
    };

    const checkRuntime = async () => {
        setChecking(true);
        try {
            const result = await checkPrivacyRuntime(privacy);
            setStatus(result);
            updatePrivacy({ runtime: result.runtime });
        } finally {
            setChecking(false);
        }
    };

    const selectedSensitivity = SENSITIVITY.reduce((best, option) =>
        Math.abs(option.value - privacy.minScore) < Math.abs(best.value - privacy.minScore) ? option : best
    );

    return (
        <div className={`rounded-lg border border-cyan-500/20 bg-cyan-500/5 ${compact ? 'p-3' : 'p-3'} text-xs`}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className="text-cyan-300" />
                    <div>
                        <div className="font-bold uppercase tracking-wide text-cyan-300">Privacy Filter</div>
                        <div className="text-[10px] text-cyan-100/70">Local PII minimization before LLM calls</div>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {status?.available && <Check size={13} className="text-emerald-300" />}
                    {status && !status.available && <AlertCircle size={13} className="text-amber-300" />}
                    <button
                        onClick={checkRuntime}
                        className="rounded border border-cyan-400/30 p-1 text-cyan-200 hover:bg-cyan-400/10"
                        title="Check local Privacy Filter sidecar"
                    >
                        <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-900/80 p-1">
                {[
                    { label: 'Off', value: 'off' as const },
                    { label: 'Detect', value: 'detect' as const },
                    { label: 'Mask', value: 'mask' as const }
                ].map(option => (
                    <button
                        key={option.value}
                        onClick={() => setMode(option.value)}
                        className={`rounded px-2 py-1.5 text-[10px] font-bold transition-colors ${privacy.mode === option.value
                            ? 'bg-cyan-600 text-white'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                            }`}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            <div className="mt-3 space-y-2">
                <label className="block text-[10px] font-bold uppercase text-slate-500">Local sidecar endpoint</label>
                <input
                    type="text"
                    value={privacy.sidecarEndpoint}
                    onChange={(event) => updatePrivacy({ sidecarEndpoint: event.target.value })}
                    placeholder="http://127.0.0.1:8765"
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-[11px] text-slate-200 outline-none focus:ring-1 focus:ring-cyan-500"
                />
            </div>

            <div className="mt-3">
                <div className="mb-1 flex justify-between text-[10px] font-bold uppercase text-slate-500">
                    <span>Sensitivity</span>
                    <span className="text-cyan-200">{selectedSensitivity.label}</span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                    {SENSITIVITY.map(option => (
                        <button
                            key={option.label}
                            onClick={() => updatePrivacy({ minScore: option.value })}
                            className={`rounded border px-2 py-1 text-[10px] ${selectedSensitivity.label === option.label
                                ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100'
                                : 'border-slate-700 text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-1">
                {PRIVACY_CATEGORIES.map(category => (
                    <label key={category} className="flex items-center gap-1 rounded border border-slate-800 bg-slate-900/60 px-2 py-1 text-[10px] text-slate-300">
                        <input
                            type="checkbox"
                            checked={privacy.categories[category]}
                            onChange={(event) => updatePrivacy({
                                categories: {
                                    ...privacy.categories,
                                    [category]: event.target.checked
                                }
                            })}
                            className="accent-cyan-500"
                        />
                        <span className="truncate">{labelFor(category)}</span>
                    </label>
                ))}
            </div>

            <label className="mt-3 flex items-start gap-2 rounded border border-slate-800 bg-slate-900/60 p-2 text-[10px] text-slate-300">
                <input
                    type="checkbox"
                    checked={privacy.blockOnUnavailable}
                    onChange={(event) => updatePrivacy({ blockOnUnavailable: event.target.checked })}
                    className="mt-0.5 accent-cyan-500"
                />
                <span>Block cloud calls if local Privacy Filter is unavailable.</span>
            </label>

            <div className="mt-2 text-[10px] leading-relaxed text-cyan-100/70">
                {status
                    ? status.available
                        ? `Available${status.version ? ` (${status.version})` : ''}${status.device ? ` on ${status.device}` : ''}.`
                        : `Unavailable: ${status.error || 'sidecar not reachable'}.`
                    : 'Expected health endpoint: /health and redact endpoint: /redact.'}
                <div className="mt-1 text-amber-200/80">Reduces exposure; not legal anonymization or compliance certification.</div>
            </div>
        </div>
    );
};

export default PrivacyFilterPanel;
