
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppConfig, DEFAULT_MODEL_OPTIONS, ToneType, FormatType, HistoryItem, ViewMode } from '../types';
import HistoryPanel from './HistoryPanel';
import RunConfigPanel from './RunConfigPanel';
import PrivacyFilterPanel from './PrivacyFilterPanel';
import { fetchModelIds } from '../services/llmService';
import { Settings2, Sliders, MessageSquare, Cpu, Server, Globe, History, Plus, X, Check, Tag, AlertCircle, FlaskConical, Layers, RefreshCw, ChevronDown, Target } from 'lucide-react';

interface SidebarProps {
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  history: HistoryItem[];
  onRestoreHistory: (item: HistoryItem) => void;
  onClearHistory: () => void;
  onClearLocalData?: () => void;
  persistHistory: boolean;
  setPersistHistory: (value: boolean) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  buildPrompt: (text: string, config: AppConfig) => string;
  inputText: string; // Passed down for preview
}

const Sidebar: React.FC<SidebarProps> = ({
  config,
  setConfig,
  history,
  onRestoreHistory,
  onClearHistory,
  onClearLocalData,
  persistHistory,
  setPersistHistory,
  viewMode,
  setViewMode,
  buildPrompt,
  inputText
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'settings' | 'history'>('settings');
  // localModelInput state removed
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);

  // Judge-specific connection state
  const [judgeConnectionStatus, setJudgeConnectionStatus] = useState<'idle' | 'checking' | 'success' | 'error'>('idle');
  const [fetchedJudgeModels, setFetchedJudgeModels] = useState<string[]>([]);

  const handleChange = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const toggleModel = (model: string) => {
    setConfig(prev => {
      const current = prev.activeModels;
      if (current.includes(model)) {
        if (current.length === 1) return prev;
        return { ...prev, activeModels: current.filter(m => m !== model) };
      } else {
        return { ...prev, activeModels: [...current, model] };
      }
    });
  };


  const isEndpointValid = () => {
    try {
      const url = config.provider === 'cloud' ? config.cloudEndpoint : config.localEndpoint;
      if (!url) return false;
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const checkConnection = async (isAuto = false) => {
    if (!isAuto) {
      setConnectionStatus('idle');
      setFetchedModels([]);
    }

    // Auto-detect Azure Deployment Name from URL
    let azureDeployment: string | null = null;
    const currentEndpoint = config.provider === 'cloud' ? config.cloudEndpoint : config.localEndpoint;

    if (config.provider === 'cloud' && currentEndpoint) {
      const match = currentEndpoint.match(/\/deployments\/([^/]+)/);
      if (match && match[1]) {
        azureDeployment = match[1];
      }
    }

    try {
      if (!currentEndpoint) return;

      try {
        const modelIdsFromApi = await fetchModelIds(
          currentEndpoint,
          config.provider,
          config.provider === 'cloud' ? config.cloudApiKey : ''
        );
        setConnectionStatus('success');

        let modelIds = modelIdsFromApi;

        // Ensure azure deployment is included
        if (azureDeployment && !modelIds.includes(azureDeployment)) {
          modelIds.push(azureDeployment);
        }

        // If we found a deployment but no other models were returned (or filtered out), use it
        if (modelIds.length === 0 && azureDeployment) {
          modelIds = [azureDeployment];
        }

        setFetchedModels(modelIds);

        // Auto-select if empty
        if (azureDeployment && config.activeModels.length === 0) {
          handleChange('activeModels', [azureDeployment]);
        }

        setTimeout(() => setConnectionStatus('idle'), 3000);
      } catch {
        // Handle Failure (e.g. 404) but allow if we found a deployment name!
        if (azureDeployment) {
          setFetchedModels([azureDeployment]);
          if (config.activeModels.length === 0) {
            handleChange('activeModels', [azureDeployment]);
          }
          setConnectionStatus('success');
          setTimeout(() => setConnectionStatus('idle'), 3000);
        } else {
          if (!isAuto) setConnectionStatus('error');
        }
      }
    } catch (e) {
      // Handle Network Error but allow if we found a deployment name!
      if (azureDeployment) {
        setFetchedModels([azureDeployment]);
        if (config.activeModels.length === 0) {
          handleChange('activeModels', [azureDeployment]);
        }
        setConnectionStatus('success');
        setTimeout(() => setConnectionStatus('idle'), 3000);
      } else {
        if (!isAuto) setConnectionStatus('error');
      }
    }
  };

  useEffect(() => {
    if (config.provider === 'local') {
      checkConnection(true);
    }
  }, [config.provider]);

  // Check Judge connection and fetch models
  const checkJudgeConnection = async () => {
    if (!config.judgeEndpoint?.trim()) return;

    setJudgeConnectionStatus('checking');
    setFetchedJudgeModels([]);

    try {
      const modelIds = await fetchModelIds(
        config.judgeEndpoint,
        config.judgeProvider,
        config.judgeProvider === 'cloud' ? config.cloudApiKey : ''
      );
      setFetchedJudgeModels(modelIds);
      setJudgeConnectionStatus('success');
    } catch (e) {
      setJudgeConnectionStatus('error');
    }
  };

  const isJudgeEndpointValid = () => {
    try {
      if (!config.judgeEndpoint?.trim()) return false;
      new URL(config.judgeEndpoint);
      return true;
    } catch {
      return false;
    }
  };

  const judgeEndpointValid = isJudgeEndpointValid();
  const endpointValid = isEndpointValid();


  // Dynamic prompt preview based on current input or placeholder
  const previewSource = inputText.trim() || "[Your source text will appear here]";
  const fullPromptPreview = buildPrompt(previewSource, config);

  return (
    <div className="w-full bg-slate-900 border-r border-slate-800 h-screen flex flex-col">
      {/* Workflow Mode Switcher */}
      <div className="p-3 border-b border-slate-800 bg-slate-950">
        <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800" role="tablist" aria-label="Workflow modes">
          <button
            onClick={() => setViewMode('playground')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-xs font-bold transition-all ${viewMode === 'playground'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-500 hover:text-slate-300'
              }`}
            role="tab"
            aria-selected={viewMode === 'playground'}
            aria-controls="playground-panel"
          >
            <FlaskConical size={14} />
            Playground
          </button>
          <button
            onClick={() => setViewMode('batch')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-xs font-bold transition-all ${viewMode === 'batch'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-500 hover:text-slate-300'
              }`}
            role="tab"
            aria-selected={viewMode === 'batch'}
            aria-controls="batch-panel"
          >
            <Layers size={14} />
            Workbench
          </button>
        </div>
      </div>

      {/* Tabs - Only show in Playground mode */}
      {viewMode === 'playground' && (
        <div className="flex border-b border-slate-800 flex-shrink-0" role="tablist" aria-label="Sidebar tabs">
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 transition-colors relative ${activeTab === 'settings' ? 'text-indigo-400 bg-slate-900/50' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900/30'}`}
            role="tab"
            aria-selected={activeTab === 'settings'}
            aria-controls="settings-panel"
          >
            <Settings2 size={14} />
            {t('sidebar.settings')}
            {activeTab === 'settings' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-indigo-500" />}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 transition-colors relative ${activeTab === 'history' ? 'text-indigo-400 bg-slate-900/50' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900/30'}`}
            role="tab"
            aria-selected={activeTab === 'history'}
            aria-controls="history-panel"
          >
            <History size={14} />
            {t('sidebar.history')}
            {activeTab === 'history' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-indigo-500" />}
          </button>
        </div>
      )}

      {viewMode === 'batch' ? (
        <div className="flex-1 overflow-y-auto bg-slate-900">
          <RunConfigPanel config={config} setConfig={setConfig} fetchedModels={fetchedModels} onRefreshModels={() => checkConnection(false)} />
          <div className="p-4 pt-0">
            <PrivacyFilterPanel config={config} setConfig={setConfig} compact />
          </div>
        </div>
      ) : (
        <>
          {activeTab === 'history' ? (
            <HistoryPanel
              history={history}
              onRestore={(item) => {
                onRestoreHistory(item);
                setActiveTab('settings');
                setViewMode('playground'); // Switch back to playground on restore
              }}
              onClear={onClearHistory}
            />
          ) : (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">

              {/* Provider Selection */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-slate-300 mb-1">
                  <Globe size={16} />
                  <label className="text-sm font-medium">{t('sidebar.provider')}</label>
                </div>
                <div className="flex bg-slate-800 p-1 rounded-lg">
                  <button
                    onClick={() => {
                      handleChange('provider', 'cloud');
                      // Reset models when switching to cloud initially if empty
                      if (!config.cloudEndpoint) {
                        handleChange('cloudEndpoint', 'https://openrouter.ai/api/v1');
                      }
                      if (config.activeModels.some(m => !m.includes('/'))) {
                        handleChange('activeModels', []);
                      }
                    }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${config.provider === 'cloud' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    {t('sidebar.cloudApi')}
                  </button>
                  <button
                    onClick={() => {
                      handleChange('provider', 'local');
                      // Keep current local models if not empty, otherwise empty
                      if (config.activeModels.length === 0) {
                        // activeModels stays empty, user must select from list
                      }
                    }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${config.provider === 'local' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    {t('sidebar.localLlm')}
                  </button>
                </div>
              </div>

              {/* Model Selection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-slate-300 mb-1">
                  <div className="flex items-center gap-2">
                    <Cpu size={16} />
                    <label className="text-sm font-medium">{t('sidebar.activeModels')}</label>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {config.activeModels.length} {t('sidebar.selected')}
                  </span>
                </div>

                {/* Cloud & Local Model List */}
                <div className="space-y-3">
                  {/* Fetched Models List */}
                  {fetchedModels.length > 0 && (
                    <div className="space-y-2 bg-slate-800/50 p-2 rounded-lg border border-slate-800">
                      <div className="flex justify-between items-center px-1 mb-1">
                        <span className="text-[10px] text-slate-500 uppercase font-bold">{t('sidebar.available')}</span>
                        <span className="text-[10px] text-emerald-400 font-mono">{fetchedModels.length} {t('sidebar.found')}</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1">
                        {fetchedModels.map(model => (
                          <button
                            key={model}
                            onClick={() => toggleModel(model)}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-all border ${config.activeModels.includes(model)
                              ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                              : 'bg-slate-800 text-slate-400 border-transparent hover:bg-slate-700 hover:text-slate-200'
                              }`}
                          >
                            <span className="truncate mr-2">{model}</span>
                            {config.activeModels.includes(model) && <Check size={12} className="text-emerald-100 flex-shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}


                  {/* Active Tags (Only show if not in fetched list OR if fetched list is empty to show confirmation) */}
                  {(fetchedModels.length === 0 || config.activeModels.some(m => !fetchedModels.includes(m))) && (
                    <div className="flex flex-wrap gap-2">
                      {config.activeModels.filter(m => fetchedModels.length === 0 || !fetchedModels.includes(m)).map(model => (
                        <div key={model} className="bg-emerald-600 text-white shadow-md shadow-emerald-900/20 text-xs px-2 py-1 rounded-md flex items-center gap-1">
                          <span>{model}</span>
                          {config.activeModels.length > 1 && (
                            <button
                              onClick={() => toggleModel(model)}
                              className="hover:text-emerald-200"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2 mt-3 pt-3 border-t border-slate-800">
                    {/* Cloud Specific: API Key */}
                    {config.provider === 'cloud' && (
                      <div className="space-y-3">
                        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                          {[
                            { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
                            { name: 'OpenAI', url: 'https://api.openai.com/v1' },
                            { name: 'Groq', url: 'https://api.groq.com/openai/v1' },
                            { name: 'DeepSeek', url: 'https://api.deepseek.com' },
                          ].map(preset => (
                            <button
                              key={preset.name}
                              onClick={() => handleChange('cloudEndpoint', preset.url)}
                              className={`px-2 py-1 text-[10px] rounded border transition-colors whitespace-nowrap ${config.cloudEndpoint === preset.url
                                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                                }`}
                            >
                              {preset.name}
                            </button>
                          ))}
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-slate-400">
                            <span className="text-[10px] uppercase font-bold">{t('sidebar.apiKey')}</span>
                          </div>
                          <input
                            type="password"
                            value={config.cloudApiKey}
                            onChange={(e) => handleChange('cloudApiKey', e.target.value)}
                            placeholder="sk-..."
                            className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-2 focus:ring-1 focus:ring-indigo-500 outline-none text-xs font-mono placeholder-slate-600"
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-slate-400">
                      <div className="flex items-center gap-1">
                        <Server size={12} />
                        <span className="text-[10px] uppercase font-bold">{config.provider === 'cloud' ? t('sidebar.baseUrl') : t('sidebar.endpoint')}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {connectionStatus === 'success' && <span className="text-[10px] text-emerald-400 font-bold">{t('sidebar.connected')}</span>}
                        {connectionStatus === 'error' && <span className="text-[10px] text-red-400 font-bold">{t('sidebar.failed')}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={config.provider === 'cloud' ? config.cloudEndpoint : config.localEndpoint}
                        onChange={(e) => handleChange(config.provider === 'cloud' ? 'cloudEndpoint' : 'localEndpoint', e.target.value)}
                        placeholder={config.provider === 'cloud' ? "https://openrouter.ai/api/v1" : "http://localhost:1234/v1/chat/completions"}
                        className={`flex-1 bg-slate-800 border ${endpointValid
                          ? 'border-slate-700 focus:ring-emerald-500' // TODO: Color based on provider
                          : 'border-red-500/50 focus:ring-red-500 text-red-300'
                          } text-slate-200 rounded-md px-3 py-2 focus:ring-2 outline-none text-xs font-mono placeholder-slate-600 transition-colors`}
                      />
                      <button
                        onClick={() => checkConnection(false)}
                        disabled={!endpointValid}
                        className={`px-2 rounded-md transition-colors ${connectionStatus === 'success' ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/30' : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400'}`}
                        title={t('sidebar.testConnectionAndFetchModels')}
                      >
                        {connectionStatus === 'success' ? <Check size={14} /> : <RefreshCw size={14} className={connectionStatus === 'idle' ? '' : 'animate-spin'} />}
                      </button>
                    </div>
                    <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-[10px] leading-relaxed text-cyan-100/80">
                      <div className="font-bold uppercase tracking-wide text-cyan-300">BYOK privacy mode</div>
                      <p className="mt-1">
                        API keys are used only for the current browser session and are not written to history snapshots.
                        Source text and outputs stay in memory unless you enable history persistence.
                      </p>
                      <button
                        onClick={() => setPersistHistory(!persistHistory)}
                        className={`mt-2 mr-2 rounded border px-2 py-1 font-bold ${persistHistory
                          ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
                          : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                          }`}
                      >
                        {persistHistory ? 'Saved history on' : 'Private mode on'}
                      </button>
                      {onClearLocalData && (
                        <button
                          onClick={onClearLocalData}
                          className="mt-2 rounded border border-cyan-400/30 px-2 py-1 font-bold text-cyan-200 hover:bg-cyan-400/10"
                        >
                          Clear local data
                        </button>
                      )}
                    </div>
                    <PrivacyFilterPanel config={config} setConfig={setConfig} />
                  </div>
                </div>

                {/* Model Version / Tag */}
                <div className="space-y-1 pt-2">
                  <div className="flex items-center gap-2 text-slate-400">
                    <Tag size={14} />
                    <label className="text-xs font-medium">{t('sidebar.versionTag')} <span className="text-slate-600 font-normal">({t('sidebar.optional')})</span></label>
                  </div>
                  <input
                    type="text"
                    value={config.modelVersion || ''}
                    onChange={(e) => handleChange('modelVersion', e.target.value)}
                    placeholder="e.g. latest"
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm placeholder-slate-600"
                  />
                </div>
              </div>

              {/* Structure & Tone */}
              <div className="space-y-4 border-t border-slate-800 pt-4">
                <h3 className="text-xs uppercase text-slate-500 font-bold tracking-wider">{t('sidebar.outputStyle')}</h3>

                <div>
                  <label className="block text-sm text-slate-400 mb-1">{t('sidebar.format')}</label>
                  <select
                    value={config.format}
                    onChange={(e) => handleChange('format', e.target.value as FormatType)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-2 text-sm"
                  >
                    {Object.values(FormatType).map((fmt) => (
                      <option key={fmt} value={fmt}>{t(`types.format.${fmt}`)}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1">{t('sidebar.tone')}</label>
                  <select
                    value={config.tone}
                    onChange={(e) => handleChange('tone', e.target.value as ToneType)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-2 text-sm"
                  >
                    {Object.values(ToneType).map((tone) => (
                      <option key={tone} value={tone}>{t(`types.tone.${tone}`)}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1">{t('sidebar.focusAreas')}</label>
                  <input
                    type="text"
                    value={config.customFocus}
                    onChange={(e) => handleChange('customFocus', e.target.value)}
                    placeholder="e.g., dates, names, financial figures"
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-2 text-sm placeholder-slate-600"
                  />
                </div>
              </div>

              {/* Parameters */}
              <div className="space-y-5 border-t border-slate-800 pt-4">
                <div className="flex items-center gap-2 text-slate-300">
                  <Sliders size={16} />
                  <h3 className="text-xs uppercase text-slate-500 font-bold tracking-wider">{t('sidebar.parameters')}</h3>
                </div>

                <div>
                  <div className="flex justify-between items-center text-xs text-slate-400 mb-2">
                    <span className="font-medium">{t('sidebar.maxWords')}</span>
                    <input
                      type="number"
                      min="10"
                      max="1000"
                      step="10"
                      value={config.maxWords}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val)) handleChange('maxWords', val);
                      }}
                      className="w-16 bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs text-right focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="1000"
                    step="10"
                    value={config.maxWords}
                    onChange={(e) => handleChange('maxWords', parseInt(e.target.value))}
                    className={`w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer ${config.provider === 'local' ? 'accent-emerald-500' : 'accent-indigo-500'}`}
                  />
                  <div className="flex justify-between text-[10px] text-slate-600 mt-1 font-mono">
                    <span>10</span>
                    <span>1000</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>{t('sidebar.temperature')}</span>
                    <span>{config.temperature}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={config.temperature}
                    onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
                    className={`w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer ${config.provider === 'local' ? 'accent-emerald-500' : 'accent-indigo-500'}`}
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>{t('sidebar.topK')}</span>
                    <span>{config.topK}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="40"
                    step="1"
                    value={config.topK}
                    onChange={(e) => handleChange('topK', parseInt(e.target.value))}
                    className={`w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer ${config.provider === 'local' ? 'accent-emerald-500' : 'accent-indigo-500'}`}
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>{t('sidebar.maxOutputTokens')}</span>
                    <span>{config.maxOutputTokens}</span>
                  </div>
                  <input
                    type="range"
                    min="100"
                    max="8192"
                    step="100"
                    value={config.maxOutputTokens}
                    onChange={(e) => handleChange('maxOutputTokens', parseInt(e.target.value))}
                    className={`w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer ${config.provider === 'local' ? 'accent-emerald-500' : 'accent-indigo-500'}`}
                  />
                </div>
              </div>

              {/* System Prompt */}
              <div className="border-t border-slate-800 pt-4 pb-6">
                <div className="flex items-center gap-2 text-slate-300 mb-2">
                  <MessageSquare size={16} />
                  <label className="text-sm font-medium">{t('sidebar.systemInstruction')}</label>
                </div>
                <textarea
                  value={config.systemInstruction}
                  onChange={(e) => handleChange('systemInstruction', e.target.value)}
                  className="w-full h-32 bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-2 text-xs resize-none focus:ring-1 focus:ring-indigo-500 mb-4"
                  placeholder="Define how the model should behave..."
                />

                {/* Prompt Preview Collapsible */}
                <div className="border border-slate-700 rounded-md overflow-hidden">
                  <button
                    onClick={() => setIsPreviewOpen(!isPreviewOpen)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-slate-800 hover:bg-slate-700 transition-colors text-xs font-medium text-slate-300"
                    aria-expanded={isPreviewOpen}
                    aria-controls="prompt-preview"
                  >
                    <span>{t('sidebar.promptPreview')}</span>
                    <span className={`transition-transform ${isPreviewOpen ? 'rotate-180' : ''}`}>v</span>
                  </button>

                  {isPreviewOpen && (
                    <div className="p-3 bg-slate-900 text-xs font-mono text-slate-400 space-y-3">
                      <div>
                        <span className="text-indigo-400 font-bold uppercase block mb-1">{t('sidebar.system')}</span>
                        <div className="bg-slate-950 p-2 rounded border border-slate-800/50">
                          {config.systemInstruction || <span className="italic opacity-50">{t('sidebar.noSystemInstructionSet')}</span>}
                        </div>
                      </div>
                      <div>
                        <span className="text-emerald-400 font-bold uppercase block mb-1">{t('sidebar.user')}</span>
                        <div className="bg-slate-950 p-2 rounded border border-slate-800/50 whitespace-pre-wrap">
                          {fullPromptPreview}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* LLM Judge Settings */}
              <div className="border-t border-slate-800 pt-4 pb-6">
                <div className="flex items-center gap-2 text-slate-300 mb-3">
                  <Target size={16} />
                  <label className="text-sm font-medium">{t('sidebar.llmJudgeSettings')}</label>
                </div>
                <div className="space-y-3">
                  {/* Use Main Model Toggle */}
                  <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                    <div className="flex-1">
                      <div className="text-xs font-medium text-slate-200">{t('sidebar.useMainConfigForJudging')}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{t('sidebar.judgeMainConfigDescription')}</div>
                    </div>
                    <button
                      onClick={() => handleChange('useMainModelAsJudge', !config.useMainModelAsJudge)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.useMainModelAsJudge ? 'bg-indigo-600' : 'bg-slate-700'
                        }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.useMainModelAsJudge ? 'translate-x-6' : 'translate-x-1'
                          }`}
                      />
                    </button>
                  </div>


                  {/* Dedicated Judge Configuration (shown when toggle is off) */}
                  {!config.useMainModelAsJudge && (
                    <div className="space-y-3 p-3 bg-purple-500/5 border border-purple-500/20 rounded-lg">
                      <div className="text-[10px] uppercase font-bold text-purple-300 flex items-center gap-1">
                        <Target size={12} />
                        {t('sidebar.dedicatedJudgeModel')}
                      </div>

                      {/* Judge Provider Selection */}
                      <div>
                        <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">{t('sidebar.provider')}</label>
                        <div className="flex bg-slate-800 p-1 rounded-lg">
                          <button
                            onClick={() => { handleChange('judgeProvider', 'cloud'); setFetchedJudgeModels([]); setJudgeConnectionStatus('idle'); }}
                            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${config.judgeProvider === 'cloud'
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-slate-200'
                              }`}
                          >
                            {t('sidebar.cloudApi')}
                          </button>
                          <button
                            onClick={() => {
                              handleChange('judgeProvider', 'local');
                              // Auto-sync endpoint when switching to local
                              handleChange('judgeEndpoint', config.localEndpoint);
                            }}
                            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${config.judgeProvider === 'local'
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-slate-200'
                              }`}
                          >
                            {t('sidebar.local')}
                          </button>
                        </div>
                      </div>

                      {/* LOCAL JUDGE UI */}
                      {config.judgeProvider === 'local' ? (
                        <div className="space-y-3">
                          <div className="text-[10px] text-slate-400 bg-slate-800/50 p-2 rounded border border-slate-700/50">
                            {t('sidebar.usingLocalModelsFrom')} <strong>{config.localEndpoint}</strong>.
                            <br />
                            <span className="opacity-70">{t('sidebar.configureConnectionInPlayground')}</span>
                          </div>

                          {fetchedModels.length > 0 ? (
                            <div className="space-y-2">
                              <label className="block text-[10px] text-slate-500 uppercase font-bold">{t('sidebar.selectLocalModel')}</label>
                              <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-1 bg-slate-800/50 p-1 rounded-lg border border-slate-800">
                                {fetchedModels.map(model => (
                                  <button
                                    key={model}
                                    onClick={() => handleChange('judgeModel', model)}
                                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-all border ${config.judgeModel === model
                                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                                      : 'bg-slate-800 text-slate-400 border-transparent hover:bg-slate-700 hover:text-slate-200'
                                      }`}
                                  >
                                    <span className="truncate mr-2">{model}</span>
                                    {config.judgeModel === model && <Check size={12} className="text-emerald-100 flex-shrink-0" />}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-amber-400 text-[10px] bg-amber-500/10 px-2 py-2 rounded border border-amber-500/20">
                              <AlertCircle size={12} />
                              <span>{t('sidebar.noLocalModelsFound')}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* CLOUD / API JUDGE UI */
                        <>
                          {/* Judge Endpoint with Connection Check */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-slate-400">
                              <div className="flex items-center gap-1">
                                <Server size={12} />
                                <span className="text-[10px] uppercase font-bold">{t('sidebar.apiEndpoint')}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                {judgeConnectionStatus === 'success' && <span className="text-[10px] text-emerald-400 font-bold">{t('sidebar.connected')}</span>}
                                {judgeConnectionStatus === 'error' && <span className="text-[10px] text-red-400 font-bold">{t('sidebar.failed')}</span>}
                              </div>
                            </div>
                            <div className="flex gap-1">
                              <input
                                type="text"
                                value={config.judgeEndpoint}
                                onChange={(e) => handleChange('judgeEndpoint', e.target.value)}
                                placeholder="https://api.openai.com/v1/chat/completions"
                                className={`flex-1 bg-slate-800 border ${judgeEndpointValid || !config.judgeEndpoint
                                  ? 'border-slate-700 focus:ring-purple-500'
                                  : 'border-red-500/50 focus:ring-red-500 text-red-300'
                                  } text-slate-200 rounded-md px-3 py-2 focus:ring-2 outline-none text-xs font-mono placeholder-slate-600 transition-colors`}
                              />
                              <button
                                onClick={checkJudgeConnection}
                                disabled={!judgeEndpointValid}
                                className={`px-2 rounded-md transition-colors ${judgeConnectionStatus === 'success'
                                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/30'
                                  : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400'}`}
                                title={t('sidebar.testConnectionAndFetchModels')}
                              >
                                {judgeConnectionStatus === 'success' ? <Check size={14} /> : <RefreshCw size={14} className={judgeConnectionStatus === 'checking' ? 'animate-spin' : ''} />}
                              </button>
                            </div>
                            <p className="text-[9px] text-slate-500">{t('sidebar.compatibleModels')}</p>
                          </div>

                          {/* Fetched Judge Models List */}
                          {fetchedJudgeModels.length > 0 && (
                            <div className="space-y-2 bg-slate-800/50 p-2 rounded-lg border border-slate-800">
                              <div className="flex justify-between items-center px-1 mb-1">
                                <span className="text-[10px] text-slate-500 uppercase font-bold">{t('sidebar.selectCloudModel')}</span>
                                <span className="text-[10px] text-emerald-400 font-mono">{fetchedJudgeModels.length} {t('sidebar.available')}</span>
                              </div>
                              <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-1">
                                {fetchedJudgeModels.map(model => (
                                  <button
                                    key={model}
                                    onClick={() => handleChange('judgeModel', model)}
                                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-all border ${config.judgeModel === model
                                      ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                                      : 'bg-slate-800 text-slate-400 border-transparent hover:bg-slate-700 hover:text-slate-200'
                                      }`}
                                  >
                                    <span className="truncate mr-2">{model}</span>
                                    {config.judgeModel === model && <Check size={12} className="text-purple-100 flex-shrink-0" />}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Manual Model Input (fallback) */}
                          <div>
                            <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">
                              {fetchedJudgeModels.length > 0 ? t('sidebar.orEnterManually') : t('sidebar.modelName')}
                            </label>
                            <input
                              type="text"
                              value={config.judgeModel}
                              onChange={(e) => handleChange('judgeModel', e.target.value)}
                              placeholder="model-small, model-medium, model-large"
                              className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-2 text-xs placeholder-slate-600"
                            />
                          </div>
                        </>
                      )}

                      {/* Config Status */}
                      {config.judgeEndpoint && config.judgeModel ? (
                        <div className="flex items-center gap-2 text-emerald-400 text-[10px] bg-emerald-500/10 px-2 py-1.5 rounded border border-emerald-500/20">
                          <Check size={12} />
                          <span>{t('sidebar.judgeReady')}: <span className="font-mono text-emerald-300">{config.judgeModel}</span></span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-amber-400 text-[10px] bg-amber-500/10 px-2 py-1.5 rounded border border-amber-500/20">
                          <AlertCircle size={12} />
                          <span>{t('sidebar.setEndpointAndSelectModel')}</span>
                        </div>
                      )}
                    </div>
                  )}


                  {/* Judge Criteria Editor */}
                  <div className="space-y-3 p-3 bg-slate-800/30 border border-slate-700 rounded-lg mt-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                        <Sliders size={12} />
                        {t('sidebar.evaluationCriteria')}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            if (confirm(t('sidebar.resetCriteriaConfirm'))) {
                              setConfig(prev => ({
                                ...prev,
                                judgeCriteria: [
                                  { id: '1', name: 'ACCURACY', weight: 30, description: 'Does it capture key information without errors?' },
                                  { id: '2', name: 'CLARITY', weight: 25, description: 'Is it easy to understand and well-structured?' },
                                  { id: '3', name: 'CONCISENESS', weight: 25, description: 'Is it appropriately concise without unnecessary details?' },
                                  { id: '4', name: 'COMPLETENESS', weight: 20, description: 'Does it cover all important points?' },
                                ]
                              }));
                            }
                          }}
                          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                          title={t('sidebar.resetCriteriaConfirm')}
                        >
                          {t('common.reset')}
                        </button>
                        <button
                          onClick={() => {
                            const newId = crypto.randomUUID();
                            setConfig(prev => ({
                              ...prev,
                              judgeCriteria: [
                                ...prev.judgeCriteria,
                                { id: newId, name: 'NEW CRITERIA', weight: 10, description: 'Description...' }
                              ]
                            }));
                          }}
                          className="text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded transition-colors"
                        >
                          + {t('common.add')}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {config.judgeCriteria.map((criterion) => (
                        <div key={criterion.id} className="bg-slate-900 p-2 rounded border border-slate-800 group">
                          <div className="flex items-center gap-2 mb-1">
                            <input
                              type="text"
                              value={criterion.name}
                              onChange={(e) => {
                                setConfig(prev => ({
                                  ...prev,
                                  judgeCriteria: prev.judgeCriteria.map(c =>
                                    c.id === criterion.id ? { ...c, name: e.target.value } : c
                                  )
                                }));
                              }}
                              className="flex-1 bg-transparent text-xs font-bold text-slate-300 outline-none border-b border-transparent focus:border-indigo-500"
                              placeholder="CRITERIA NAME"
                            />
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                value={criterion.weight}
                                onChange={(e) => {
                                  setConfig(prev => ({
                                    ...prev,
                                    judgeCriteria: prev.judgeCriteria.map(c =>
                                      c.id === criterion.id ? { ...c, weight: parseInt(e.target.value) || 0 } : c
                                    )
                                  }));
                                }}
                                className="w-8 bg-slate-800 text-[10px] text-right text-indigo-300 rounded px-1 outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                              <span className="text-[10px] text-slate-500">%</span>
                            </div>
                            <button
                              onClick={() => {
                                setConfig(prev => ({
                                  ...prev,
                                  judgeCriteria: prev.judgeCriteria.filter(c => c.id !== criterion.id)
                                }));
                              }}
                              className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X size={12} />
                            </button>
                          </div>
                          <input
                            type="text"
                            value={criterion.description}
                            onChange={(e) => {
                              setConfig(prev => ({
                                ...prev,
                                judgeCriteria: prev.judgeCriteria.map(c =>
                                  c.id === criterion.id ? { ...c, description: e.target.value } : c
                                )
                              }));
                            }}
                            className="w-full bg-transparent text-[10px] text-slate-500 outline-none border-b border-transparent focus:border-slate-600 placeholder-slate-700"
                            placeholder="Description of what to evaluate..."
                          />
                        </div>
                      ))}
                    </div>

                    {/* Total Weight Indicator */}
                    <div className="flex justify-between items-center px-1">
                      <span className="text-[10px] text-slate-500">Total Weight</span>
                      <span className={`text-[10px] font-bold ${config.judgeCriteria.reduce((sum, c) => sum + c.weight, 0) === 100
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                        }`}>
                        {config.judgeCriteria.reduce((sum, c) => sum + c.weight, 0)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )
      }
      {/* Footer Branding */}
      <div className="p-3 border-t border-slate-800 text-center">
        <div className="flex items-center justify-center gap-1.5 opacity-40 hover:opacity-80 transition-opacity select-none">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">ClaroIA</span>
          <span className="text-[10px] text-slate-600">local-first BYOK</span>
        </div>
      </div>
    </div >
  );
};

export default Sidebar;
