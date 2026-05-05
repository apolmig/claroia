import {
    AppConfig,
    ModelProvider,
    PrivacyCategory,
    PrivacyCategoryConfig,
    PrivacyFilterConfig,
    PrivacyFilterResult,
    PrivacyMetadata,
    PrivacyMode,
    PrivacyRuntime,
    PrivacySpan
} from "../types";

export const PRIVACY_CATEGORIES: PrivacyCategory[] = [
    "private_person",
    "private_address",
    "private_email",
    "private_phone",
    "private_url",
    "private_date",
    "account_number",
    "secret"
];

export const DEFAULT_PRIVACY_CATEGORIES: PrivacyCategoryConfig = {
    private_person: true,
    private_address: true,
    private_email: true,
    private_phone: true,
    private_url: true,
    private_date: true,
    account_number: true,
    secret: true
};

export const DEFAULT_PRIVACY_FILTER_CONFIG: PrivacyFilterConfig = {
    enabled: false,
    mode: "off",
    runtime: "unavailable",
    sidecarEndpoint: "http://127.0.0.1:8765",
    categories: DEFAULT_PRIVACY_CATEGORIES,
    minScore: 0.5,
    blockOnUnavailable: true
};

export interface PrivacyRuntimeStatus {
    runtime: PrivacyRuntime;
    available: boolean;
    version?: string;
    modelLoaded?: boolean;
    device?: string;
    labels?: string[];
    error?: string;
}

export interface PrivacyFilterOptions {
    signal?: AbortSignal;
}

export interface PrivacyAppliedText {
    text: string;
    result: PrivacyFilterResult;
    metadata: PrivacyMetadata;
}

const PRIVACY_TIMEOUT_MS = 20_000;

const isAbortError = (error: unknown): boolean =>
    error instanceof DOMException && error.name === "AbortError" ||
    error instanceof Error && error.name === "AbortError";

const getAppMode = (): string => {
    try {
        return import.meta.env.VITE_APP_MODE || "local";
    } catch {
        return "local";
    }
};

const emptyCounts = (): Record<PrivacyCategory, number> =>
    PRIVACY_CATEGORIES.reduce((acc, category) => {
        acc[category] = 0;
        return acc;
    }, {} as Record<PrivacyCategory, number>);

const activeCategories = (categories: PrivacyCategoryConfig): PrivacyCategory[] =>
    PRIVACY_CATEGORIES.filter(category => categories[category]);

const isLoopbackEndpoint = (endpoint: string): boolean => {
    try {
        const { hostname, protocol } = new URL(endpoint);
        return protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(hostname);
    } catch {
        return false;
    }
};

const endpointFor = (endpoint: string, path: "health" | "redact"): string => {
    const url = new URL(endpoint);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.endsWith(`/${path}`)) return url.toString();
    if (pathname.endsWith("/health") || pathname.endsWith("/redact")) {
        url.pathname = pathname.replace(/\/(health|redact)$/, `/${path}`);
        return url.toString();
    }
    url.pathname = `${pathname}/${path}`.replace(/^\/\//, "/");
    return url.toString();
};

const fetchWithTimeout = async (url: string, init: RequestInit = {}, options: PrivacyFilterOptions = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PRIVACY_TIMEOUT_MS);
    const abortFromParent = () => controller.abort();

    if (options.signal?.aborted) {
        clearTimeout(timeout);
        throw new DOMException("Privacy filter request aborted", "AbortError");
    }

    options.signal?.addEventListener("abort", abortFromParent, { once: true });

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abortFromParent);
    }
};

export const checkPrivacyRuntime = async (
    config: PrivacyFilterConfig,
    options: PrivacyFilterOptions = {}
): Promise<PrivacyRuntimeStatus> => {
    if (getAppMode() === "netlify") {
        return {
            runtime: "unavailable",
            available: false,
            error: "Local Privacy Filter sidecar is unavailable in the public Netlify demo."
        };
    }

    if (!isLoopbackEndpoint(config.sidecarEndpoint)) {
        return {
            runtime: "unavailable",
            available: false,
            error: "Privacy Filter sidecar endpoint must be a local HTTP loopback URL."
        };
    }

    try {
        const response = await fetchWithTimeout(endpointFor(config.sidecarEndpoint, "health"), {}, options);
        if (!response.ok) {
            return { runtime: "unavailable", available: false, error: `Health check failed (${response.status})` };
        }

        const data = await response.json().catch(() => ({}));
        return {
            runtime: "local-sidecar",
            available: true,
            version: data.version,
            modelLoaded: data.modelLoaded ?? data.model_loaded,
            device: data.device,
            labels: Array.isArray(data.labels) ? data.labels : undefined
        };
    } catch (error) {
        if (isAbortError(error)) throw error;
        return {
            runtime: "unavailable",
            available: false,
            error: error instanceof Error ? error.message : "Privacy Filter sidecar unavailable"
        };
    }
};

export const maskFromSpans = (
    text: string,
    spans: PrivacySpan[],
    categories: PrivacyCategoryConfig = DEFAULT_PRIVACY_CATEGORIES
): string => {
    const validSpans = spans
        .filter(span =>
            categories[span.label] &&
            Number.isFinite(span.start) &&
            Number.isFinite(span.end) &&
            span.start >= 0 &&
            span.end > span.start &&
            span.start < text.length
        )
        .map(span => ({ ...span, start: Math.max(0, span.start), end: Math.min(text.length, span.end) }))
        .sort((a, b) => a.start - b.start || b.end - a.end);

    let cursor = 0;
    let output = "";

    for (const span of validSpans) {
        if (span.start < cursor) continue;
        output += text.slice(cursor, span.start);
        output += `[${span.label.toUpperCase()}]`;
        cursor = span.end;
    }

    output += text.slice(cursor);
    return output;
};

const normalizeSpans = (value: unknown, text: string, categories: PrivacyCategoryConfig, minScore: number): PrivacySpan[] => {
    if (!Array.isArray(value)) return [];

    return value
        .map((span: any): PrivacySpan | null => {
            const label = String(span.label || span.entity_group || span.entity || "").replace(/^PRIVATE_/, "private_").toLowerCase() as PrivacyCategory;
            const start = Number(span.start);
            const end = Number(span.end);
            const score = Number(span.score ?? 1);

            if (!PRIVACY_CATEGORIES.includes(label)) return null;
            if (!categories[label]) return null;
            if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
            if (score < minScore) return null;

            return {
                start,
                end,
                label,
                score,
                textPreview: String(span.textPreview || span.word || text.slice(start, Math.min(end, start + 32)))
            };
        })
        .filter(Boolean) as PrivacySpan[];
};

const countsFor = (spans: PrivacySpan[]): Record<PrivacyCategory, number> => {
    const counts = emptyCounts();
    spans.forEach(span => {
        counts[span.label] += 1;
    });
    return counts;
};

export const filterText = async (
    text: string,
    config: PrivacyFilterConfig,
    options: PrivacyFilterOptions = {}
): Promise<PrivacyFilterResult> => {
    if (!text) {
        return {
            originalLength: 0,
            maskedText: "",
            spans: [],
            countsByCategory: emptyCounts(),
            runtime: "unavailable",
            filteredAt: Date.now()
        };
    }

    if (!config.enabled || config.mode === "off") {
        return {
            originalLength: text.length,
            maskedText: text,
            spans: [],
            countsByCategory: emptyCounts(),
            runtime: "unavailable",
            filteredAt: Date.now()
        };
    }

    const status = await checkPrivacyRuntime(config, options);
    if (!status.available) {
        throw new Error(status.error || "Privacy Filter sidecar unavailable");
    }

    const response = await fetchWithTimeout(endpointFor(config.sidecarEndpoint, "redact"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            text,
            categories: activeCategories(config.categories),
            minScore: config.minScore,
            mode: config.mode
        })
    }, options);

    if (!response.ok) {
        throw new Error(`Privacy Filter redaction failed (${response.status})`);
    }

    const data = await response.json();
    const spans = normalizeSpans(data.spans || data.entities || data.output, text, config.categories, config.minScore);
    const maskedText = config.mode === "mask"
        ? maskFromSpans(text, spans, config.categories)
        : text;

    return {
        originalLength: text.length,
        maskedText,
        spans,
        countsByCategory: countsFor(spans),
        runtime: "local-sidecar",
        filteredAt: Date.now()
    };
};

export const metadataFromPrivacyResult = (
    result: PrivacyFilterResult,
    mode: PrivacyMode
): PrivacyMetadata => ({
    masked: mode === "mask" && result.spans.length > 0 && result.maskedText !== "",
    mode,
    runtime: result.runtime,
    countsByCategory: result.countsByCategory,
    originalLength: result.originalLength,
    filteredAt: result.filteredAt || Date.now()
});

export const combinePrivacyMetadata = (
    primary: PrivacyMetadata,
    secondary?: PrivacyMetadata
): PrivacyMetadata => {
    if (!secondary) return primary;

    const countsByCategory = emptyCounts();
    PRIVACY_CATEGORIES.forEach(category => {
        countsByCategory[category] =
            (primary.countsByCategory?.[category] || 0) +
            (secondary.countsByCategory?.[category] || 0);
    });

    return {
        masked: primary.masked || secondary.masked,
        mode: primary.mode !== "off" ? primary.mode : secondary.mode,
        runtime: primary.runtime === "local-sidecar" && secondary.runtime === "local-sidecar"
            ? "local-sidecar"
            : "unavailable",
        countsByCategory,
        originalLength: primary.originalLength + secondary.originalLength,
        filteredAt: Math.max(primary.filteredAt, secondary.filteredAt)
    };
};

export const applyPrivacyFilter = async (
    text: string,
    config: AppConfig,
    provider: ModelProvider,
    options: PrivacyFilterOptions = {}
): Promise<PrivacyAppliedText> => {
    const privacyConfig = config.privacyFilter || DEFAULT_PRIVACY_FILTER_CONFIG;
    const disabledResult: PrivacyFilterResult = {
        originalLength: text.length,
        maskedText: text,
        spans: [],
        countsByCategory: emptyCounts(),
        runtime: "unavailable",
        filteredAt: Date.now()
    };

    if (!privacyConfig.enabled || privacyConfig.mode === "off") {
        return {
            text,
            result: disabledResult,
            metadata: metadataFromPrivacyResult(disabledResult, "off")
        };
    }

    try {
        const result = await filterText(text, privacyConfig, options);
        return {
            text: privacyConfig.mode === "mask" ? result.maskedText : text,
            result,
            metadata: metadataFromPrivacyResult(result, privacyConfig.mode)
        };
    } catch (error) {
        if (isAbortError(error)) throw error;

        if (privacyConfig.mode === "mask" || (privacyConfig.blockOnUnavailable && provider === "cloud")) {
            throw new Error(`Privacy Filter blocked request: ${error instanceof Error ? error.message : "unavailable"}`);
        }

        return {
            text,
            result: disabledResult,
            metadata: metadataFromPrivacyResult(disabledResult, privacyConfig.mode)
        };
    }
};

export const privacySummaryText = (metadata?: PrivacyMetadata): string => {
    if (!metadata || !metadata.masked) return "Privacy Filter off";
    const total = Object.values(metadata.countsByCategory).reduce((sum, count) => sum + count, 0);
    return `Privacy filtered: ${total} span${total === 1 ? "" : "s"} masked`;
};
