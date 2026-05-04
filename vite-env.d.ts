/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_GEMINI_API_KEY?: string;
    readonly VITE_DEFAULT_CLOUD_ENDPOINT?: string;
    readonly VITE_DEFAULT_LOCAL_ENDPOINT?: string;
    readonly VITE_APP_MODE?: 'local' | 'netlify';
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
