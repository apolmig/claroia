import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FileText, X, ClipboardPaste, Database, Play, Layers, Check, Settings } from 'lucide-react';
import { AppConfig, BatchItem, ViewMode } from '../types';
import { filterText, metadataFromPrivacyResult } from '../services/privacyFilterService';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface InputAreaProps {
    text: string;
    setText: (text: string) => void;
    onGenerate: () => void;
    isGenerating: boolean;
    viewMode: ViewMode;
    batchItems: BatchItem[];
    setBatchItems: React.Dispatch<React.SetStateAction<BatchItem[]>>;
    config: AppConfig;
    batchProgress?: { current: number; total: number };
    onStop?: () => void;
}

const InputArea: React.FC<InputAreaProps> = ({
    text,
    setText,
    onGenerate,
    isGenerating,
    viewMode,
    batchItems,
    setBatchItems,
    config,
    batchProgress,
    onStop
}) => {
    const { t } = useTranslation();
    const [dragActive, setDragActive] = useState(false);
    const [isScanningPrivacy, setIsScanningPrivacy] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            await processFiles(Array.from(e.dataTransfer.files));
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            await processFiles(Array.from(e.target.files));
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const processFiles = async (files: File[]) => {
        if (viewMode === 'batch') {
            let allNewItems: BatchItem[] = [];
            for (const file of files) {
                try {
                    const lowerName = file.name.toLowerCase();
                    let items: BatchItem[] = [];

                    if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.docx')) {
                        alert('This document format is disabled in the public build for security. Please export it as CSV, TXT, Markdown, JSON, or PDF and upload that file.');
                        continue;
                    } else if (lowerName.endsWith('.pdf')) {
                        items = await parsePdf(file);
                    } else {
                        const content = await readFile(file);
                        items = parseBatchFileContent(content, file.name);
                    }

                    allNewItems = [...allNewItems, ...items];
                } catch (err) {
                    console.error('Error reading uploaded file.');
                }
            }

            if (allNewItems.length > 0) {
                setBatchItems(prev => [...prev, ...allNewItems]);
            } else {
                if (files.length > 0) alert("No valid text entries found in the uploaded files.");
            }
        } else {
            // Playground: just take the first file content
            if (files.length > 0) {
                const file = files[0];
                const lowerName = file.name.toLowerCase();
                let content = '';

                try {
                    if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.docx')) {
                        alert('This document format is disabled in the public build for security. Please export it as CSV, TXT, Markdown, JSON, or PDF and upload that file.');
                        return;
                    } else if (lowerName.endsWith('.pdf')) {
                        const items = await parsePdf(file);
                        if (items.length > 0) content = items[0].sourceText;
                    } else {
                        content = await readFile(file);
                    }

                    if (content) setText(content);
                } catch (err) {
                    console.error("Error parsing uploaded file.");
                    alert("Failed to parse file content.");
                }
            }
        }
    };

    const readFile = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string || '');
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    };

    const parsePdf = async (file: File): Promise<BatchItem[]> => {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const items: BatchItem[] = [];

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map((item: any) => item.str).join(' ');

                if (pageText.trim().length > 0) {
                    items.push({
                        id: crypto.randomUUID(),
                        title: `${file.name.replace(/\.[^/.]+$/, '')} - Page ${i}`,
                        sourceText: pageText.trim(),
                        status: 'pending',
                        results: {},
                        evaluations: {}
                    });
                }
            }

            return items;
        } catch (err) {
            throw new Error("Failed to parse PDF file");
        }
    };

    // Robust CSV Parser: Handles newlines within quotes
    const parseCSV = (text: string): string[][] => {
        const rows: string[][] = [];
        let currentRow: string[] = [];
        let currentField = '';
        let inQuote = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const nextChar = text[i + 1];

            if (char === '"') {
                if (inQuote && nextChar === '"') {
                    currentField += '"';
                    i++;
                } else {
                    inQuote = !inQuote;
                }
            } else if (char === ',' && !inQuote) {
                currentRow.push(currentField);
                currentField = '';
            } else if ((char === '\n' || char === '\r') && !inQuote) {
                if (char === '\r' && nextChar === '\n') i++;
                currentRow.push(currentField);
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
            } else {
                currentField += char;
            }
        }
        if (currentField || currentRow.length) {
            currentRow.push(currentField);
            rows.push(currentRow);
        }
        return rows;
    };

    const parseBatchFileContent = (content: string, filename: string): BatchItem[] => {
        try {
            let newItems: BatchItem[] = [];
            const lowerFilename = filename.toLowerCase();

            if (lowerFilename.endsWith('.json')) {
                const json = JSON.parse(content);
                let dataArray: any[] = [];

                // Handle nested structures - look for array in common properties
                if (Array.isArray(json)) {
                    dataArray = json;
                } else if (typeof json === 'object' && json !== null) {
                    const possibleKeys = ['items', 'data', 'records', 'rows', 'inputs', 'examples', 'batch'];
                    for (const key of possibleKeys) {
                        if (Array.isArray(json[key])) {
                            dataArray = json[key];
                            break;
                        }
                    }
                    // Fallback: Find any array property
                    if (dataArray.length === 0) {
                        const keys = Object.keys(json);
                        for (const key of keys) {
                            if (Array.isArray(json[key])) {
                                dataArray = json[key];
                                break;
                            }
                        }
                    }
                }

                if (dataArray.length > 0) {
                    newItems = dataArray.map((item: any, idx: number) => {
                        let sourceText = '';
                        let title = '';

                        // Robust Field Detection
                        if (typeof item === 'string') {
                            sourceText = item;
                            title = `${filename} #${idx + 1}`;
                        } else if (typeof item === 'object' && item !== null) {
                            // Text Candidates - Check for standard keys first
                            const textKeys = ['text', 'content', 'input', 'body', 'sourceText', 'prompt', 'description', 'message', 'article', 'review', 'abstract'];
                            const foundTextKey = textKeys.find(k => item[k] && typeof item[k] === 'string');
                            if (foundTextKey) {
                                sourceText = item[foundTextKey];
                            }

                            // Title Candidates
                            const titleKeys = ['title', 'name', 'id', 'label', 'identifier', 'subject', 'headline'];
                            const foundTitleKey = titleKeys.find(k => item[k] && (typeof item[k] === 'string' || typeof item[k] === 'number'));
                            title = foundTitleKey ? String(item[foundTitleKey]) : `${filename} #${idx + 1}`;

                            // Fallback: Infer text from longest string value if no standard key matched or if found text is empty
                            if (!sourceText) {
                                const stringValues = Object.values(item).filter(v => typeof v === 'string') as string[];
                                if (stringValues.length > 0) {
                                    // Heuristic: Longest string is likely the main content
                                    sourceText = stringValues.reduce((a, b) => a.length > b.length ? a : b, '');
                                }
                            }
                        }

                        // Extract reference summary for JSON objects
                        let referenceSummary: string | undefined = undefined;
                        if (typeof item === 'object' && item !== null) {
                            const referenceKeys = ['reference', 'master', 'expected', 'ground_truth', 'groundtruth', 'target', 'gold', 'ideal'];
                            const foundRefKey = referenceKeys.find(k => k in item && typeof item[k] === 'string');
                            if (foundRefKey) {
                                referenceSummary = item[foundRefKey];
                            }
                        }

                        return {
                            id: crypto.randomUUID(),
                            title: String(title || `${filename} #${idx + 1}`),
                            sourceText: typeof sourceText === 'string' ? sourceText : JSON.stringify(sourceText),
                            referenceSummary: referenceSummary,
                            status: 'pending' as const,
                            results: {},
                            evaluations: {}
                        };
                    }).filter(i => i.sourceText && i.sourceText.trim().length > 0);
                }
            } else if (lowerFilename.endsWith('.csv')) {
                const rows = parseCSV(content);
                if (rows.length > 0) {
                    // Determine headers
                    // Heuristic: First row is header if it contains typical strings
                    const firstRow = rows[0];
                    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const normalizedHeader = firstRow.map(normalize);

                    const textKeywords = ['text', 'content', 'input', 'body', 'sourcetext', 'prompt', 'description', 'message', 'review', 'article'];
                    const titleKeywords = ['title', 'name', 'id', 'label', 'identifier', 'subject'];
                    const referenceKeywords = ['reference', 'master', 'expected', 'groundtruth', 'target', 'gold', 'ideal'];

                    let textColIdx = normalizedHeader.findIndex(h => textKeywords.includes(h));
                    let titleColIdx = normalizedHeader.findIndex(h => titleKeywords.includes(h));
                    let referenceColIdx = normalizedHeader.findIndex(h => referenceKeywords.includes(h));

                    // Fuzzy match if exact match fails
                    if (textColIdx === -1) textColIdx = normalizedHeader.findIndex(h => textKeywords.some(k => h.includes(k)));
                    if (titleColIdx === -1) titleColIdx = normalizedHeader.findIndex(h => titleKeywords.some(k => h.includes(k)));
                    if (referenceColIdx === -1) referenceColIdx = normalizedHeader.findIndex(h => referenceKeywords.some(k => h.includes(k)));

                    const hasHeader = textColIdx !== -1 || titleColIdx !== -1 || referenceColIdx !== -1;
                    const startRow = hasHeader ? 1 : 0;

                    // If no header detected, default text to column 0, title to -1
                    if (!hasHeader) {
                        textColIdx = 0;
                    }

                    for (let i = startRow; i < rows.length; i++) {
                        const row = rows[i];
                        if (row[textColIdx] && row[textColIdx].trim()) {
                            const referenceVal = (referenceColIdx > -1 && row[referenceColIdx])
                                ? row[referenceColIdx].trim()
                                : undefined;

                            newItems.push({
                                id: crypto.randomUUID(),
                                title: (titleColIdx > -1 && row[titleColIdx]) ? row[titleColIdx].trim() : `${filename} #${i + 1}`,
                                sourceText: row[textColIdx].trim(),
                                referenceSummary: referenceVal || undefined,
                                status: 'pending' as const,
                                results: {},
                                evaluations: {}
                            });
                        }
                    }
                }
            } else if (lowerFilename.endsWith('.md')) {
                // Markdown Parsing Strategy
                // 1. Split by horizontal rules (--- or ***)
                // 2. If no rules, treat as single item

                const sections = content.split(/^---+$/m);

                sections.forEach((section, idx) => {
                    const trimmed = section.trim();
                    if (trimmed) {
                        // Try to extract a title from the first line if it starts with #
                        const lines = trimmed.split('\n');
                        let title = `${filename.replace(/\.[^/.]+$/, '')} Section ${idx + 1}`;
                        let body = trimmed;

                        if (lines[0] && lines[0].trim().startsWith('#')) {
                            const titleLine = lines[0].trim();
                            title = titleLine.replace(/^#+\s*/, '').trim();
                            // Keep title in body for context
                        }

                        newItems.push({
                            id: crypto.randomUUID(),
                            title: title,
                            sourceText: body,
                            status: 'pending',
                            results: {},
                            evaluations: {}
                        });
                    }
                });

                // If regex split didn't work (no ---), fallback to treating as one item
                if (newItems.length === 0 && content.trim()) {
                    newItems.push({
                        id: crypto.randomUUID(),
                        title: filename.replace(/\.[^/.]+$/, ''),
                        sourceText: content.trim(),
                        status: 'pending',
                        results: {},
                        evaluations: {}
                    });
                }

            } else {
                // Plain Text: Split by double newline to separate distinct blocks
                const sections = content.split(/\n\n+/);
                newItems = sections.map((s, idx) => ({
                    id: crypto.randomUUID(),
                    title: `${filename} - Part ${idx + 1}`,
                    sourceText: s.trim(),
                    status: 'pending' as const,
                    results: {},
                    evaluations: {}
                })).filter(i => i.sourceText);
            }

            return newItems;
        } catch (err) {
            return [];
        }
    };

    const clearBatch = () => {
        if (confirm("Clear all batch items? This will remove all loaded data and results.")) {
            setBatchItems([]);
        }
    }

    const resetBatchStatus = () => {
        if (confirm("Reset all batch items to 'pending' status? This will allow you to re-run the batch process.")) {
            setBatchItems(prev => prev.map(item => ({ ...item, status: 'pending', results: {}, evaluations: {} })));
        }
    }

    const scanBatchPrivacy = async () => {
        if (!config.privacyFilter.enabled || config.privacyFilter.mode === 'off') {
            alert('Enable Privacy Filter in the sidebar first.');
            return;
        }
        if (batchItems.length === 0) return;

        setIsScanningPrivacy(true);
        try {
            const scanned = await Promise.all(batchItems.map(async (item) => {
                const result = await filterText(item.sourceText, config.privacyFilter);
                const metadata = metadataFromPrivacyResult(result, config.privacyFilter.mode);
                let maskedReferenceSummary = item.maskedReferenceSummary;

                if (item.referenceSummary && config.privacyFilter.mode === 'mask') {
                    const referenceResult = await filterText(item.referenceSummary, config.privacyFilter);
                    maskedReferenceSummary = referenceResult.maskedText;
                }

                return {
                    ...item,
                    privacy: metadata,
                    maskedSourceText: config.privacyFilter.mode === 'mask' ? result.maskedText : item.maskedSourceText,
                    maskedReferenceSummary
                };
            }));
            setBatchItems(scanned);
        } catch (error) {
            alert(`Privacy scan failed: ${error instanceof Error ? error.message : 'Privacy Filter unavailable'}`);
        } finally {
            setIsScanningPrivacy(false);
        }
    };

    if (viewMode === 'batch') {
        const hasPendingItems = batchItems.some(item => item.status === 'pending');
        const hasDoneItems = batchItems.some(item => item.status === 'done');
        const hasActiveRunConfigs = config.activeRunConfigs.length > 0;
        const canRunBatch = hasPendingItems && hasActiveRunConfigs;

        return (
            <div className="flex flex-col h-full">
                {/* Header with Controls */}
                <div className="flex-shrink-0 p-6 pb-4 border-b border-slate-800">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
                            <Database className="text-indigo-400" />
                            {t('input.batchDatasets')}
                        </h2>
                        {batchItems.length > 0 && (
                            <div className="flex gap-2">
                                {hasDoneItems && (
                                    <button
                                        onClick={resetBatchStatus}
                                        className="px-3 py-1.5 text-amber-400 hover:text-amber-300 border border-amber-500/30 hover:bg-amber-500/10 transition-colors text-xs font-medium rounded-md"
                                        title="Reset all items to pending status to re-run"
                                    >
                                        {t('input.resetRerun')}
                                    </button>
                                )}
                                <button
                                    onClick={scanBatchPrivacy}
                                    disabled={isScanningPrivacy || batchItems.length === 0}
                                    className="px-3 py-1.5 text-cyan-300 hover:text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/10 disabled:opacity-40 transition-colors text-xs font-medium rounded-md"
                                    title="Scan all batch items with Privacy Filter"
                                >
                                    {isScanningPrivacy ? 'Scanning...' : 'Scan privacy'}
                                </button>
                                <button
                                    onClick={clearBatch}
                                    className="px-3 py-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/30 transition-colors text-xs font-medium rounded-md"
                                >
                                    {t('input.clearAll')} ({batchItems.length})
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto p-6 pt-4 min-h-0">
                    <div
                        className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center transition-colors hover:border-indigo-500/50 hover:bg-slate-800/30 group cursor-pointer"
                        onDragOver={handleDrag}
                        onDragLeave={handleDrag}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        role="button"
                        aria-label="Upload files area. Click or drag files here."
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                fileInputRef.current?.click();
                            }
                        }}
                    >
                        {batchItems.length === 0 ? (
                            <div className="text-center space-y-3">
                                <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto text-indigo-400">
                                    <Layers size={32} />
                                </div>
                                <h3 className="text-lg font-medium text-slate-200">{t('input.dragDropDatasets')}</h3>
                                <p className="text-sm text-slate-500 max-w-xs mx-auto">
                                    {t('input.uploadHint')}
                                </p>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="mt-4 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                                >
                                    {t('input.browseFiles')}
                                </button>
                            </div>
                        ) : (
                            <div className="w-full h-full flex flex-col">
                                <div className="flex justify-between items-center mb-2 text-sm text-slate-400">
                                    <span>Preview ({batchItems.length} items)</span>
                                    <button onClick={() => fileInputRef.current?.click()} className="text-indigo-400 hover:underline">{t('input.addMore')}</button>
                                </div>
                                <div className="flex-1 overflow-y-auto border border-slate-800 rounded-lg bg-slate-950 p-2 space-y-1 custom-scrollbar">
                                    {batchItems.map((item, idx) => (
                                        <div key={item.id} className="text-xs text-slate-300 p-2 bg-slate-900 rounded border border-slate-800 flex gap-2">
                                            <span className="text-slate-600 font-mono w-6 text-right">{idx + 1}.</span>
                                            <div className="flex-1 overflow-hidden">
                                                {item.title && <div className="font-bold text-slate-400">{item.title}</div>}
                                                <div className="truncate opacity-70">{item.sourceText}</div>
                                            </div>
                                            <span className={`text-[10px] uppercase px-1 rounded h-fit ${item.status === 'done' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                                                {item.status}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept=".txt,.csv,.json,.md,.pdf"
                            multiple
                            className="hidden"
                        />
                    </div>
                </div>

                {/* Sticky Bottom Button Bar */}
                <div className="flex-shrink-0 p-6 pt-4 border-t border-slate-800 bg-slate-950">
                    <button
                        onClick={isGenerating ? onStop : onGenerate}
                        disabled={!isGenerating && !canRunBatch}
                        className={`w-full py-3 rounded-xl font-semibold text-white transition-all duration-200 flex items-center justify-center gap-2 shadow-lg ${isGenerating
                            ? 'bg-red-500 hover:bg-red-600 hover:scale-[1.01] active:scale-[0.99] shadow-red-500/20'
                            : !canRunBatch
                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                : 'bg-indigo-600 hover:bg-indigo-500 hover:scale-[1.01] active:scale-[0.99] shadow-indigo-500/20'
                            }`}
                        title={!hasActiveRunConfigs ? 'Select at least one run configuration before processing.' : (!hasPendingItems && batchItems.length > 0 ? 'All items processed. Click "Reset & Re-run" to process again.' : '')}
                    >
                        {isGenerating ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                {batchProgress && batchProgress.total > 0
                                    ? t('input.stopBatch', { current: batchProgress.current, total: batchProgress.total })
                                    : t('common.stop')}
                            </>
                        ) : !hasActiveRunConfigs ? (
                            <>
                                <Settings size={18} />
                                Select a run configuration
                            </>
                        ) : !hasPendingItems && batchItems.length > 0 ? (
                            <>
                                <Check size={18} />
                                {t('common.done')}
                            </>
                        ) : (
                            <>
                                <Play size={18} fill="currentColor" />
                                {t('input.playBatch', { pending: batchItems.filter(i => i.status === 'pending').length })}
                            </>
                        )}
                    </button>
                    {!hasPendingItems && batchItems.length > 0 && (
                        <p className="text-xs text-slate-500 text-center mt-2">
                            💡 Tip: Click "Reset & Re-run" to process items again with different configurations
                        </p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full p-6 gap-4">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-slate-100">{t('input.sourceContent')}</h2>
                <div className="flex gap-2">
                    <button
                        onClick={() => setText('')}
                        className="p-2 text-slate-400 hover:text-red-400 transition-colors"
                        title={t('common.clear')}
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            <div className="relative flex-1 flex flex-col">
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="flex-1 w-full bg-slate-900/50 border border-slate-700 rounded-xl p-4 text-slate-300 resize-none focus:ring-2 focus:ring-indigo-500/50 outline-none placeholder-slate-600 font-mono text-sm"
                    placeholder={t('common.inputPlaceholder')}
                    onDragEnter={handleDrag}
                />

                {/* Drag Overlay */}
                {dragActive && (
                    <div
                        className="absolute inset-0 bg-indigo-500/20 border-2 border-dashed border-indigo-500 rounded-xl flex flex-col items-center justify-center backdrop-blur-sm z-10"
                        onDragEnter={handleDrag}
                        onDragLeave={handleDrag}
                        onDragOver={handleDrag}
                        onDrop={handleDrop}
                    >
                        <Upload className="text-indigo-300 mb-2" size={48} />
                        <p className="text-indigo-100 font-medium">Drop file to load content</p>
                    </div>
                )}

                {/* File Input Helper */}
                <div className="absolute bottom-4 right-4 flex gap-2">
                    <button
                        onClick={async () => {
                            try {
                                const text = await navigator.clipboard.readText();
                                setText(text);
                            } catch (err) {
                                console.error('Failed to read clipboard.');
                            }
                        }}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors border border-slate-700"
                    >
                        <ClipboardPaste size={14} />
                        {t('input.pasteClipboard')}
                    </button>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors border border-slate-700"
                    >
                        <FileText size={14} />
                        {t('input.loadFile')}
                    </button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept=".txt,.csv,.md,.json,.pdf"
                        className="hidden"
                    />
                </div>
            </div>

            <button
                onClick={onGenerate}
                disabled={isGenerating || !text.trim()}
                className={`w-full py-3 rounded-xl font-semibold text-white transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 ${isGenerating || !text.trim()
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-500 hover:scale-[1.01] active:scale-[0.99]'
                    }`}
            >
                {isGenerating ? (
                    <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        {t('common.processing')}
                    </>
                ) : (
                    t('common.generate')
                )}
            </button>
        </div>
    );
};

export default InputArea;
