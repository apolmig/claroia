import { useState, useCallback, useRef, useEffect } from 'react';

interface UseResizableOptions {
    initialRatio?: number;
    minRatio?: number;
    maxRatio?: number;
    direction?: 'horizontal' | 'vertical';
}

export const useResizable = ({
    initialRatio = 50,
    minRatio = 20,
    maxRatio = 80,
    direction = 'horizontal'
}: UseResizableOptions = {}) => {
    const [ratio, setRatio] = useState(initialRatio);
    const containerRef = useRef<HTMLDivElement>(null);
    const isResizing = useRef(false);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current || !containerRef.current) return;

        const containerRect = containerRef.current.getBoundingClientRect();

        let newRatio;
        if (direction === 'horizontal') {
            newRatio = ((e.clientX - containerRect.left) / containerRect.width) * 100;
        } else {
            newRatio = ((e.clientY - containerRect.top) / containerRect.height) * 100;
        }

        setRatio(Math.min(Math.max(newRatio, minRatio), maxRatio));
    }, [direction, minRatio, maxRatio]);

    const stopResizing = useCallback(() => {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', stopResizing);
    }, [handleMouseMove]);

    const startResizing = useCallback(() => {
        isResizing.current = true;
        document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', stopResizing);
    }, [direction, handleMouseMove, stopResizing]);

    useEffect(() => {
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [handleMouseMove, stopResizing]);

    return { ratio, setRatio, containerRef, startResizing, isResizing };
};

export const useResizableSidebar = (initialWidth = 320, minWidth = 200, maxWidth = 800) => {
    const [width, setWidth] = useState(initialWidth);
    const isResizing = useRef(false);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current) return;
        const newWidth = e.clientX;
        setWidth(Math.min(Math.max(newWidth, minWidth), maxWidth));
    }, [minWidth, maxWidth]);

    const stopResizing = useCallback(() => {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', stopResizing);
    }, [handleMouseMove]);

    const startResizing = useCallback(() => {
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', stopResizing);
    }, [handleMouseMove, stopResizing]);

    useEffect(() => {
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [handleMouseMove, stopResizing]);

    return { width, startResizing, isResizing };
};
