import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary component to catch and handle React errors gracefully
 * Prevents the entire app from crashing when a component throws an error
 */
class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
        this.setState({
            error,
            errorInfo
        });
    }

    handleReset = () => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null
        });
    };

    render() {
        if (this.state.hasError) {
            // Custom fallback UI
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // Default error UI
            return (
                <div className="flex items-center justify-center min-h-screen bg-slate-950 p-4">
                    <div className="max-w-md w-full bg-slate-900 border border-red-500/30 rounded-lg p-6 space-y-4">
                        <div className="flex items-center gap-3 text-red-400">
                            <AlertTriangle size={24} />
                            <h2 className="text-xl font-bold">Something went wrong</h2>
                        </div>

                        <div className="bg-slate-950 border border-slate-800 rounded p-3">
                            <p className="text-sm text-slate-300 font-mono">
                                {this.state.error?.message || 'Unknown error'}
                            </p>
                        </div>

                        {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
                            <details className="text-xs text-slate-500">
                                <summary className="cursor-pointer hover:text-slate-400">
                                    Stack trace
                                </summary>
                                <pre className="mt-2 p-2 bg-slate-950 rounded overflow-auto max-h-48">
                                    {this.state.errorInfo.componentStack}
                                </pre>
                            </details>
                        )}

                        <button
                            onClick={this.handleReset}
                            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white py-2 px-4 rounded-md transition-colors"
                        >
                            <RefreshCw size={16} />
                            Try Again
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
