
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Download, SplitSquareHorizontal, Minimize2 } from 'lucide-react';
import Skeleton from '../src/components/Skeleton';

interface OutputAreaProps {
  results: Record<string, string>; // Map of model -> summary
  isGenerating?: boolean;
}

const OutputArea: React.FC<OutputAreaProps> = ({ results, isGenerating = false }) => {
  const { t } = useTranslation();
  const models = Object.keys(results);
  const hasResults = models.length > 0;
  const isComparison = models.length > 1;

  // Determine shortest summary logic
  let shortestModel: string | null = null;
  if (isComparison) {
    // Prioritize valid responses over errors when determining shortest
    const validModels = models.filter(m => !results[m].startsWith('Error:'));
    const candidates = validModels.length > 0 ? validModels : models;

    if (candidates.length > 0) {
      shortestModel = candidates.reduce((prev, curr) =>
        results[curr].length < results[prev].length ? curr : prev
      );
    }
  }

  const SummaryCard = ({ model, text, isShortest }: { model: string; text: string; isShortest: boolean }) => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = () => {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = () => {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `summary-${model}-${new Date().toISOString()}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    const isError = text.startsWith('Error:');

    return (
      <div
        className={`flex flex-col h-full bg-slate-900/50 border rounded-xl overflow-hidden transition-all duration-300 ${isShortest ? 'border-emerald-500/50 shadow-lg shadow-emerald-900/10' : 'border-slate-700'}`}
        role="region"
        aria-label={`Summary from ${model}`}
      >
        {/* Header for Card */}
        <div className="bg-slate-900/80 border-b border-slate-800 p-3 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-indigo-300 uppercase tracking-wider">{model}</span>
            {isShortest && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30">
                <Minimize2 size={10} className="text-emerald-400" />
                <span className="text-[9px] font-bold text-emerald-300 uppercase tracking-wider">{t('output.mostConcise')}</span>
              </div>
            )}
          </div>
          <div className="flex gap-1">
            <button
              onClick={handleDownload}
              className="p-1.5 text-slate-400 hover:text-indigo-400 transition-colors rounded hover:bg-slate-800"
              title={t('output.download')}
              aria-label={`Download summary from ${model}`}
            >
              <Download size={14} />
            </button>
            <button
              onClick={handleCopy}
              className="p-1.5 text-slate-400 hover:text-indigo-400 transition-colors rounded hover:bg-slate-800"
              title={t('output.copy')}
              aria-label={`Copy summary from ${model}`}
            >
              {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          className="flex-1 p-4 overflow-y-auto custom-scrollbar"
          tabIndex={0}
          role="article"
        >
          {isError ? (
            <div className="text-red-400 text-sm font-mono" role="alert">{text}</div>
          ) : (
            <article className="prose prose-invert prose-sm max-w-none prose-headings:text-indigo-300 prose-strong:text-indigo-200 prose-a:text-blue-400">
              <ReactMarkdown>{text}</ReactMarkdown>
            </article>
          )}
        </div>

        {/* Metadata Footer */}
        {!isError && (
          <div className="bg-slate-900/30 border-t border-slate-800/50 p-2 px-4 text-[10px] text-slate-500 flex justify-end gap-3 font-mono">
            <span>{text.split(/\s+/).filter(Boolean).length} {t('output.words')}</span>
            <span>{text.length} {t('output.chars')}</span>
          </div>
        )}
      </div>
    );
  };

  if (isGenerating) {
    return (
      <div className="flex flex-col h-full p-6" aria-live="polite" aria-busy="true">
        <h2 className="text-xl font-semibold text-slate-100 flex items-center gap-2 mb-4 animate-pulse">
          Generating Summaries...
        </h2>
        <div className="flex-1 grid gap-4 grid-cols-1 overflow-hidden">
          <Skeleton variant="card" lines={6} />
        </div>
      </div>
    );
  }

  if (!hasResults) {
    return (
      <div className="flex flex-col h-full p-6 items-center justify-center text-slate-600">
        <div className="w-16 h-16 bg-slate-900 rounded-full flex items-center justify-center mb-4">
          <SplitSquareHorizontal size={32} className="opacity-50" />
        </div>
        <p className="text-sm font-medium">{t('output.emptyTitle')}</p>
        <p className="text-xs mt-2 text-slate-700">{t('output.emptySubtitle')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-6" aria-live="polite">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
          {t('output.results')}
          {isComparison && <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full">{t('output.comparisonMode')}</span>}
        </h2>
      </div>

      <div className={`flex-1 grid gap-4 overflow-hidden ${isComparison ? 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'}`}>
        {models.map((model) => (
          <div key={model} className="min-h-0 flex flex-col h-full">
            <SummaryCard
              model={model}
              text={results[model]}
              isShortest={model === shortestModel}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default OutputArea;
