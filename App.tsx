
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useResizable, useResizableSidebar } from './src/hooks/useResizable';
import { useBatchProcessor } from './src/hooks/useBatchProcessor';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import InputArea from './components/InputArea';
import OutputArea from './components/OutputArea';
import BatchResults from './components/BatchResults';
import { AppConfig, ToneType, FormatType, HistoryItem, ViewMode, BatchItem } from './types';
import { generateSummary, buildPrompt } from './services/llmService';
import { applyPrivacyFilter, DEFAULT_PRIVACY_FILTER_CONFIG } from './services/privacyFilterService';
import { PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import { useToast } from './src/hooks/useToast';
import SkipLink from './src/components/SkipLink';

const DEFAULT_CONFIG: AppConfig = {
  provider: 'cloud',
  activeModels: [], // Agnostic default: user must select or fetch models
  modelVersion: '',
  // Default Cloud Config (OpenRouter)
  cloudEndpoint: import.meta.env.VITE_DEFAULT_CLOUD_ENDPOINT || 'https://openrouter.ai/api/v1',
  cloudApiKey: '',
  localEndpoint: import.meta.env.VITE_DEFAULT_LOCAL_ENDPOINT || 'http://localhost:1234/v1/chat/completions', // LM Studio Default
  temperature: 0.5,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 4096, // Increased default for reasoning models (e.g. o1/gpt-5)
  systemInstruction: "You are a helpful, precise AI assistant specialized in summarizing content.",
  tone: ToneType.PROFESSIONAL,
  format: FormatType.PARAGRAPH,
  customFocus: "",
  maxWords: 250,
  runConfigurations: [],
  activeRunConfigs: [],
  // LLM Judge defaults - empty values mean not configured
  judgeProvider: 'local',
  judgeModel: '',
  judgeEndpoint: '', // Must be set for judge to work
  useMainModelAsJudge: false, // Default to independent judge
  judgeCriteria: [
    { id: '1', name: 'ACCURACY', weight: 30, description: 'Does it capture key information without errors?' },
    { id: '2', name: 'CLARITY', weight: 25, description: 'Is it easy to understand and well-structured?' },
    { id: '3', name: 'CONCISENESS', weight: 25, description: 'Is it appropriately concise without unnecessary details?' },
    { id: '4', name: 'COMPLETENESS', weight: 20, description: 'Does it cover all important points?' },
  ],
  privacyFilter: DEFAULT_PRIVACY_FILTER_CONFIG
};

const sanitizeConfigForHistory = (config: AppConfig): AppConfig => ({
  ...config,
  cloudApiKey: '',
  privacyFilter: {
    ...DEFAULT_PRIVACY_FILTER_CONFIG,
    ...config.privacyFilter,
    categories: {
      ...DEFAULT_PRIVACY_FILTER_CONFIG.categories,
      ...(config.privacyFilter?.categories || {})
    }
  }
});

const STORAGE_KEYS = {
  persistHistory: 'claroia_persist_history',
  history: 'claroia_history'
};

const isHistoryPersistenceEnabled = () =>
  localStorage.getItem(STORAGE_KEYS.persistHistory) === 'true';

const removeHistoryStorage = () => {
  localStorage.removeItem(STORAGE_KEYS.persistHistory);
  localStorage.removeItem(STORAGE_KEYS.history);
};

const App: React.FC = () => {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [inputText, setInputText] = useState<string>("");
  const [results, setResults] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('playground');
  const [persistHistory, setPersistHistory] = useState<boolean>(() => {
    try {
      return isHistoryPersistenceEnabled();
    } catch {
      return false;
    }
  });

  // Resizable Frame State
  const {
    ratio: splitRatio,
    setRatio: setSplitRatio,
    containerRef,
    startResizing
  } = useResizable({ initialRatio: 50, minRatio: 20, maxRatio: 80 });

  // Sidebar Resizing State
  const {
    width: sidebarWidth,
    startResizing: startResizingSidebar
  } = useResizableSidebar(320, 200, 800);

  // Batch State
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  // batchProgress is now derived
  const batchProgress = {
    current: batchItems.filter(i => i.status === 'done').length + (batchItems.some(i => i.status === 'processing') ? 1 : 0),
    total: batchItems.length
  };

  const {
    isGenerating: isBatchGenerating,
    processBatch,
    stopBatch
  } = useBatchProcessor({ config, batchItems, setBatchItems });

  // History State
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      if (!isHistoryPersistenceEnabled()) return [];
      const saved = localStorage.getItem(STORAGE_KEYS.history);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    if (persistHistory) {
      localStorage.setItem(STORAGE_KEYS.persistHistory, 'true');
      localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
    } else {
      removeHistoryStorage();
    }
  }, [history, persistHistory]);

  // Reset split ratio when view mode changes for better defaults
  useEffect(() => {
    if (viewMode === 'batch') {
      setSplitRatio(30);
    } else {
      setSplitRatio(50);
    }
  }, [viewMode]);

  const handleGenerate = useCallback(async () => {
    if (viewMode === 'batch') {
      processBatch();
      return;
    }

    if (!inputText) {
      addToast('error', t('app.errorNoInput', 'Please enter some text to summarize.'));
      return;
    }

    if (config.activeModels.length === 0) {
      addToast('error', t('app.errorNoModel', 'Please select at least one model from the sidebar.'));
      return;
    }


    setIsGenerating(true);
    setResults({});

    const startTime = Date.now();

    try {
      const privacyApplied = await applyPrivacyFilter(inputText, config, config.provider);
      const llmInputText = privacyApplied.text;

      if (privacyApplied.metadata.masked) {
        addToast('success', 'Privacy Filter applied. Only masked text will be sent to the LLM.');
      } else if (config.privacyFilter.enabled && config.privacyFilter.mode === 'detect') {
        addToast('success', 'Privacy Filter scan complete. Detect-only mode leaves text unchanged.');
      }

      // Parallel Execution for all active models
      const modelPromises = config.activeModels.map(async (model) => {
        try {
          const result = await generateSummary(llmInputText, config, model);
          return { model, text: result };
        } catch (e: any) {
          return { model, text: `Error: ${e.message}` };
        }
      });

      const responses = await Promise.all(modelPromises);

      // Convert array to Record map
      const newResults: Record<string, string> = {};
      responses.forEach(r => {
        newResults[r.model] = r.text;
      });

      setResults(newResults);
      addToast('success', t('app.generationComplete', 'Generation complete!'));


      // Add to history
      const newItem: HistoryItem = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        sourceText: llmInputText,
        results: newResults, // Store the map
        config: sanitizeConfigForHistory(config),
        durationMs: Date.now() - startTime,
        privacy: privacyApplied.metadata.mode === 'off' ? undefined : privacyApplied.metadata
      };

      setHistory(prev => [...prev, newItem]);

    } catch (error: any) {
      const message = error?.message || t('app.criticalError');
      setResults({ "System": `Error: ${message}` });
      addToast('error', message);

    } finally {
      setIsGenerating(false);
    }
  }, [inputText, config, viewMode, batchItems]);



  const handleUpdateEvaluation = (itemId: string, model: string, field: string, value: any) => {
    setBatchItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const currentEval = item.evaluations[model] || { score: 0, note: '', isGroundTruth: false };

      // If marking as Ground Truth, unmark others for this item if you only want one GT
      let updatedEvaluations = { ...item.evaluations };

      if (field === 'isGroundTruth' && value === true) {
        // Reset others
        Object.keys(updatedEvaluations).forEach(k => {
          updatedEvaluations[k] = { ...updatedEvaluations[k], isGroundTruth: false };
        });
      }

      updatedEvaluations[model] = { ...currentEval, [field]: value };

      return { ...item, evaluations: updatedEvaluations };
    }));
  };

  const handleUpdateItem = (itemId: string, field: 'referenceSummary' | 'humanValidated', value: any) => {
    setBatchItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      return { ...item, [field]: value };
    }));
  };

  const handleRestoreHistory = (item: HistoryItem) => {
    setConfig(prev => ({
      ...item.config,
      cloudApiKey: item.config.cloudApiKey || prev.cloudApiKey,
      privacyFilter: {
        ...DEFAULT_PRIVACY_FILTER_CONFIG,
        ...item.config.privacyFilter,
        categories: {
          ...DEFAULT_PRIVACY_FILTER_CONFIG.categories,
          ...(item.config.privacyFilter?.categories || {})
        }
      }
    }));
    setInputText(item.sourceText);
    setResults(item.results);
  };

  const handleClearHistory = () => {
    if (confirm(t('app.clearHistoryConfirm'))) {
      setHistory([]);
    }
  };

  const handleClearLocalData = () => {
    if (confirm(t('app.clearLocalDataConfirm', 'Clear all local history and runtime data? API keys in the current form will also be cleared.'))) {
      removeHistoryStorage();
      setPersistHistory(false);
      setHistory([]);
      setResults({});
      setBatchItems([]);
      setInputText('');
      setConfig(prev => ({ ...prev, cloudApiKey: '' }));
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 overflow-hidden">
      <SkipLink />
      <TitleBar />
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <div
          role="navigation"
          aria-label="Main sidebar"
          style={{ width: isSidebarOpen ? `${sidebarWidth}px` : '0px' }}
          className={`transition-[width] duration-300 ease-in-out border-r border-slate-800 flex-shrink-0 relative group/sidebar`}
        >
          <div className="h-full overflow-hidden" style={{ width: `${sidebarWidth}px` }}>
            <Sidebar
              config={config}
              setConfig={setConfig}
              history={history}
              onRestoreHistory={handleRestoreHistory}
              onClearHistory={handleClearHistory}
              onClearLocalData={handleClearLocalData}
              persistHistory={persistHistory}
              setPersistHistory={setPersistHistory}
              viewMode={viewMode}
              setViewMode={setViewMode}
              buildPrompt={buildPrompt}
              inputText={inputText}
            />
          </div>

          {/* Sidebar Resizer Handle */}
          <div
            role="separator"
            aria-label="Resize sidebar"
            className="absolute right-0 top-0 w-1.5 h-full cursor-col-resize hover:bg-indigo-500 transition-colors z-50 translate-x-1/2 bg-transparent hover:delay-75 active:bg-indigo-600"
            onMouseDown={startResizingSidebar}
          >
            {/* Visual Indicator on Hover */}
            <div className="absolute inset-y-0 left-1/2 w-[1px] bg-slate-700 group-hover/sidebar:bg-indigo-500/50 transition-colors" />
          </div>
        </div>

        {/* Main Content */}
        <main
          id="main-content"
          role="main"
          className="flex-1 flex flex-col h-full relative min-w-0"
        >
          {/* Mobile/Toggle Header */}
          <div className="h-14 border-b border-slate-800 flex items-center px-4 justify-between bg-slate-950 z-20 flex-shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(!isSidebarOpen)}
                className="text-slate-400 hover:text-white transition-colors"
                aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
                aria-expanded={isSidebarOpen}
              >
                {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
              </button>
              <h1 className="text-lg font-bold text-slate-100 tracking-tight flex items-center gap-2">
                Claro<span className={config.provider === 'local' ? 'text-emerald-500' : 'text-indigo-500'}>IA</span>
                {config.provider === 'local' && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 rounded border border-emerald-500/30">{t('common.local')}</span>}
              </h1>
            </div>
            <div className="text-xs text-slate-500 font-mono hidden sm:block">
              {config.activeModels.length > 1 ? `${config.activeModels.length} ${t('app.modelsActive')}` : config.activeModels[0]}
              {config.modelVersion && <span className="ml-2 opacity-50">({config.modelVersion})</span>}
            </div>
          </div>

          {/* Content Grid with Resizer */}
          <div ref={containerRef} className="flex-1 flex flex-col md:flex-row overflow-hidden relative">

            {/* Input Section */}
            {/* Desktop: Uses splitRatio width */}
            <div
              style={{ width: `${splitRatio}%` }}
              className={`
                    border-b md:border-b-0 md:border-r border-slate-800 min-h-0 transition-[width] duration-0
                    h-1/2 md:h-full w-full md:w-auto
                `}
            >
              <InputArea
                text={inputText}
                setText={setInputText}
                onGenerate={handleGenerate}
                isGenerating={viewMode === 'batch' ? isBatchGenerating : isGenerating}
                viewMode={viewMode}
                batchItems={batchItems}
                setBatchItems={setBatchItems}
                config={config}
                batchProgress={batchProgress}
                onStop={viewMode === 'batch' ? stopBatch : undefined}
              />
            </div>

            {/* Desktop Resizer Handle */}
            <div
              className="hidden md:flex w-3 -ml-1.5 bg-transparent hover:bg-indigo-500/10 cursor-col-resize items-center justify-center z-30 absolute h-full"
              style={{ left: `${splitRatio}%` }}
              onMouseDown={startResizing}
            >
              <div className="h-8 w-1 bg-slate-700 rounded-full hover:bg-indigo-400 transition-colors" />
            </div>

            {/* Output Section */}
            <div
              style={{ width: `${100 - splitRatio}%` }}
              className={`
                    bg-slate-950/50 min-h-0
                    h-1/2 md:h-full w-full md:w-auto ml-auto
                `}
            >
              {viewMode === 'batch' ? (
                <BatchResults
                  items={batchItems}
                  activeModels={config.activeModels}
                  config={config}
                  onUpdateEvaluation={handleUpdateEvaluation}
                  onUpdateItem={handleUpdateItem}
                />
              ) : (
                <OutputArea results={results} isGenerating={isGenerating} />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
