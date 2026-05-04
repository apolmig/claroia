
import React from 'react';
import { HistoryItem, AppConfig } from '../types';
import { Clock, ArrowUpRight, FileJson, Trash2, Bot, User, Sparkles } from 'lucide-react';

interface HistoryPanelProps {
  history: HistoryItem[];
  onRestore: (item: HistoryItem) => void;
  onClear: () => void;
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({ history, onRestore, onClear }) => {

  const exportHistory = () => {
    const dataStr = JSON.stringify(history, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `summary-history-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 p-6 text-center">
        <Clock size={48} className="mb-4 opacity-20" />
        <p className="text-sm">No history yet.</p>
        <p className="text-xs mt-1">Generate summaries to build your log.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
        <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Clock size={16} />
          Session History <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{history.length}</span>
        </h3>
        <div className="flex gap-1">
             <button
                onClick={exportHistory}
                className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded transition-colors"
                title="Export JSON Logs"
            >
                <FileJson size={16} />
            </button>
            <button
                onClick={onClear}
                className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
                title="Clear History"
            >
                <Trash2 size={16} />
            </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-3 custom-scrollbar">
        {history.slice().reverse().map((item) => {
            // Get the first result to display as preview
            const firstModelKey = Object.keys(item.results)[0];
            const resultText = item.results[firstModelKey];
            const isError = resultText?.startsWith('Error:');

            return (
              <div
                key={item.id}
                className="group bg-slate-900 border border-slate-800 rounded-lg p-3 hover:border-indigo-500/50 hover:shadow-md transition-all flex flex-col gap-3"
              >
                {/* Meta Header */}
                <div className="flex justify-between items-center pb-2 border-b border-slate-800/50">
                   <div className="flex flex-col">
                     <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                        {new Date(item.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                     </span>
                   </div>
                   <div className="flex items-center gap-2">
                        <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">
                             {item.config.activeModels.length} Model{item.config.activeModels.length > 1 ? 's' : ''}
                        </span>
                        <button
                            onClick={() => onRestore(item)}
                            className="text-indigo-400 bg-indigo-500/10 p-1 rounded hover:bg-indigo-500 hover:text-white transition-all"
                            title="Restore this session"
                        >
                            <ArrowUpRight size={14} />
                        </button>
                   </div>
                </div>

                {/* User Input Section */}
                <div className="flex gap-2.5 items-start">
                    <div className="mt-0.5 bg-slate-800 p-1 rounded-md flex-shrink-0">
                        <User size={12} className="text-slate-400" />
                    </div>
                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                        {item.sourceText}
                    </p>
                </div>

                {/* AI Output Section */}
                {resultText && (
                    <div className="flex gap-2.5 items-start">
                        <div className={`mt-0.5 p-1 rounded-md flex-shrink-0 ${isError ? 'bg-red-900/20' : 'bg-emerald-900/20'}`}>
                            {isError ? (
                                <Bot size={12} className="text-red-400" />
                            ) : (
                                <Sparkles size={12} className="text-emerald-400" />
                            )}
                        </div>
                        <p className={`text-xs line-clamp-3 leading-relaxed font-mono ${isError ? 'text-red-400' : 'text-slate-400'}`}>
                            {resultText}
                        </p>
                    </div>
                )}

                {/* Footer Config Tags */}
                <div className="flex flex-wrap gap-1.5 pt-1 opacity-60 hover:opacity-100 transition-opacity">
                    <span className="text-[9px] text-slate-500">
                        {item.config.tone} • {item.config.format} • {item.config.maxWords}w
                    </span>
                </div>
              </div>
            );
        })}
      </div>
    </div>
  );
};

export default HistoryPanel;
