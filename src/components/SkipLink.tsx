import React from 'react';

/**
 * Skip link for keyboard-only users to bypass navigation
 * Becomes visible only when focused
 */
const SkipLink: React.FC = () => {
    return (
        <a
            href="#main-content"
            className="
                sr-only focus:not-sr-only
                focus:fixed focus:top-4 focus:left-4 focus:z-[100]
                focus:px-4 focus:py-2 focus:rounded-lg
                focus:bg-indigo-600 focus:text-white
                focus:outline-none focus:ring-2 focus:ring-indigo-400
                transition-all
            "
        >
            Skip to main content
        </a>
    );
};

export default SkipLink;
