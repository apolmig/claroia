import React, { createContext, useState, useCallback, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useToast } from '../hooks/useToast';

// Toast types
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
    id: string;
    type: ToastType;
    message: string;
    duration?: number;
}

interface ToastContextType {
    toasts: Toast[];
    addToast: (type: ToastType, message: string, duration?: number) => void;
    removeToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextType | null>(null);

/**
 * Toast provider component - wrap your app with this
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((type: ToastType, message: string, duration = 5000) => {
        const id = crypto.randomUUID();
        setToasts(prev => [...prev, { id, type, message, duration }]);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
            {children}
            <ToastContainer />
        </ToastContext.Provider>
    );
};

/**
 * Individual toast item component
 */
const ToastItem: React.FC<{ toast: Toast; onClose: () => void }> = ({ toast, onClose }) => {
    useEffect(() => {
        if (toast.duration && toast.duration > 0) {
            const timer = setTimeout(onClose, toast.duration);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [toast.duration, onClose]);

    const icons = {
        success: <CheckCircle className="w-5 h-5 text-emerald-400" />,
        error: <AlertCircle className="w-5 h-5 text-red-400" />,
        warning: <AlertTriangle className="w-5 h-5 text-amber-400" />,
        info: <Info className="w-5 h-5 text-blue-400" />
    };

    const colors = {
        success: 'border-emerald-500/30 bg-emerald-500/10',
        error: 'border-red-500/30 bg-red-500/10',
        warning: 'border-amber-500/30 bg-amber-500/10',
        info: 'border-blue-500/30 bg-blue-500/10'
    };

    return (
        <div
            role="alert"
            aria-live="assertive"
            className={`
                flex items-start gap-3 p-4 rounded-lg border backdrop-blur-sm
                shadow-lg animate-in slide-in-from-right-full duration-300
                ${colors[toast.type]}
            `}
        >
            {icons[toast.type]}
            <p className="flex-1 text-sm text-slate-200">{toast.message}</p>
            <button
                onClick={onClose}
                className="text-slate-400 hover:text-white transition-colors"
                aria-label="Dismiss notification"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
};

/**
 * Container for all active toasts
 */
const ToastContainer: React.FC = () => {
    const { toasts, removeToast } = useToast();

    if (toasts.length === 0) return null;

    return (
        <div
            className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
            aria-label="Notifications"
        >
            {toasts.map(toast => (
                <ToastItem
                    key={toast.id}
                    toast={toast}
                    onClose={() => removeToast(toast.id)}
                />
            ))}
        </div>
    );
};

export default ToastProvider;
