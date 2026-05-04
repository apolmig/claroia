/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'happy-dom',
        setupFiles: './src/setupTests.ts',
        css: true,
        include: ['**/*.test.{ts,tsx}'],
        exclude: ['**/node_modules/**', '**/dist/**', 'vite.config.test.ts'],
    },
});
