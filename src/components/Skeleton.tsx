import React from 'react';

interface SkeletonProps {
    variant?: 'text' | 'card' | 'table';
    lines?: number;
    className?: string;
}

/**
 * Animated loading skeleton component
 * Provides visual feedback while content is loading
 */
const Skeleton: React.FC<SkeletonProps> = ({
    variant = 'text',
    lines = 3,
    className = ''
}) => {
    const baseClass = "animate-pulse bg-slate-700/50 rounded";

    if (variant === 'card') {
        return (
            <div className={`space-y-4 p-4 ${className}`} role="status" aria-label="Loading content">
                <div className={`${baseClass} h-6 w-3/4`} />
                <div className={`${baseClass} h-4 w-full`} />
                <div className={`${baseClass} h-4 w-5/6`} />
                <div className={`${baseClass} h-4 w-2/3`} />
                <div className="flex gap-2 mt-4">
                    <div className={`${baseClass} h-8 w-20`} />
                    <div className={`${baseClass} h-8 w-24`} />
                </div>
                <span className="sr-only">Loading...</span>
            </div>
        );
    }

    if (variant === 'table') {
        return (
            <div className={`space-y-2 ${className}`} role="status" aria-label="Loading table">
                {/* Header */}
                <div className="flex gap-4 pb-2 border-b border-slate-700">
                    <div className={`${baseClass} h-4 w-1/4`} />
                    <div className={`${baseClass} h-4 w-1/3`} />
                    <div className={`${baseClass} h-4 w-1/5`} />
                </div>
                {/* Rows */}
                {Array.from({ length: lines }).map((_, i) => (
                    <div key={i} className="flex gap-4 py-2">
                        <div className={`${baseClass} h-4 w-1/4`} />
                        <div className={`${baseClass} h-4 w-1/3`} />
                        <div className={`${baseClass} h-4 w-1/5`} />
                    </div>
                ))}
                <span className="sr-only">Loading table data...</span>
            </div>
        );
    }

    // Default: text variant
    return (
        <div className={`space-y-2 ${className}`} role="status" aria-label="Loading text">
            {Array.from({ length: lines }).map((_, i) => (
                <div
                    key={i}
                    className={`${baseClass} h-4`}
                    style={{ width: `${85 - (i * 10)}%` }}
                />
            ))}
            <span className="sr-only">Loading...</span>
        </div>
    );
};

export default Skeleton;
