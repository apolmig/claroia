import { AppConfig, FormatType, JudgeCriteria, ModelProvider, RunConfiguration } from "../types";
import { retryWithBackoff } from "../src/utils/requestQueue";

export interface LlmRequestOptions {
    signal?: AbortSignal;
}

interface RequestRuntimeConfig {
    systemInstruction: string;
    temperature: number;
    topP: number;
    maxOutputTokens: number;
}

export interface JudgeRuntime {
    provider: ModelProvider;
    model: string;
    endpoint: string;
    apiKey: string;
}

const NETLIFY_PROXY_CHAT_PATH = "/api/chat";
const NETLIFY_PROXY_MODELS_PATH = "/api/models";

const isAbortError = (error: unknown): boolean =>
    error instanceof DOMException && error.name === "AbortError" ||
    error instanceof Error && error.name === "AbortError";

const throwIfAborted = (signal?: AbortSignal) => {
    if (signal?.aborted) {
        throw new DOMException("Request aborted", "AbortError");
    }
};

const getAppMode = (): string => {
    try {
        return import.meta.env.VITE_APP_MODE || "local";
    } catch {
        return "local";
    }
};

const shouldUseNetlifyProxy = (): boolean => getAppMode() === "netlify";

export const buildPrompt = (text: string, config: AppConfig): string => {
    let userPrompt = `Please summarize the following text.\n\nOriginal Text:\n"${text}"\n\nRequirements:`;
    userPrompt += `\n- Tone: ${config.tone}`;
    userPrompt += `\n- Format: ${config.format}`;
    userPrompt += `\n- Maximum Length: ${config.maxWords} words`;
    userPrompt += `\n- LANGUAGE CONSTRAINT: The summary MUST be written in the EXACT SAME LANGUAGE as the Original Text. Do not translate.`;

    if (config.customFocus) {
        userPrompt += `\n- Pay special attention to: ${config.customFocus}`;
    }

    if (config.format === FormatType.JSON) {
        userPrompt += `\n- Return the result as a valid JSON object with a 'summary' key and a 'key_points' array.`;
    }

    return userPrompt;
};

function validateSummaryInputs(text: string, config: AppConfig): { valid: boolean; error?: string } {
    if (!text?.trim()) {
        return { valid: false, error: "Input text is required and cannot be empty" };
    }

    if (text.length > 1000000) {
        return { valid: false, error: "Input text is too long (max 1M characters)" };
    }

    if (config.provider === "cloud") {
        if (!config.cloudEndpoint?.trim()) {
            return { valid: false, error: "Cloud endpoint is required for cloud provider" };
        }
        if (!config.cloudApiKey?.trim()) {
            return { valid: false, error: "API key is required for cloud provider" };
        }
    }

    if (config.provider === "local" && !config.localEndpoint?.trim()) {
        return { valid: false, error: "Local endpoint is required for local provider" };
    }

    return { valid: true };
}

export const generateSummary = async (
    text: string,
    config: AppConfig,
    modelOverride?: string,
    options: LlmRequestOptions = {}
): Promise<string> => {
    throwIfAborted(options.signal);

    const validation = validateSummaryInputs(text, config);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    const prompt = buildPrompt(text, config);
    const modelToUse = modelOverride || config.activeModels[0];

    if (!modelToUse) {
        throw new Error("No model selected. Please select at least one model.");
    }

    if (config.provider === "local") {
        return generateGenericOpenAIRequest(prompt, config, modelToUse, config.localEndpoint, "", options);
    }

    if (config.provider === "cloud") {
        return generateGenericOpenAIRequest(prompt, config, modelToUse, config.cloudEndpoint, config.cloudApiKey, options);
    }

    throw new Error("Invalid provider configuration. Use cloud or local endpoints.");
};

export function normalizeEndpointUrl(endpoint: string): string {
    const urlStr = endpoint.trim();

    try {
        const urlObj = new URL(urlStr);
        const pathname = urlObj.pathname;

        if (pathname.endsWith("/chat/completions") || pathname.endsWith("/generateContent")) {
            return urlStr;
        }

        if (pathname.endsWith("/v1")) {
            urlObj.pathname = pathname + "/chat/completions";
            return urlObj.toString();
        }

        if (pathname.endsWith("/models")) {
            urlObj.pathname = pathname.replace(/\/models$/, "/chat/completions");
            return urlObj.toString();
        }

        urlObj.pathname = pathname.replace(/\/+$/, "") + "/chat/completions";
        return urlObj.toString();
    } catch {
        let base = urlStr;
        const queryIndex = urlStr.indexOf("?");
        let query = "";

        if (queryIndex !== -1) {
            base = urlStr.substring(0, queryIndex);
            query = urlStr.substring(queryIndex);
        }

        if (base.endsWith("/")) {
            base = base.slice(0, -1);
        }

        if (base.endsWith("/chat/completions") || base.endsWith("/generateContent")) {
            return urlStr;
        }

        if (base.endsWith("/v1")) {
            return `${base}/chat/completions${query}`;
        }

        if (base.endsWith("/models")) {
            return base.replace("/models", "/chat/completions") + query;
        }

        return `${base}/chat/completions${query}`;
    }
}

export function normalizeModelsEndpoint(endpoint: string, provider: ModelProvider): string {
    const urlStr = endpoint.trim();

    try {
        const urlObj = new URL(urlStr);
        const pathname = urlObj.pathname;

        if (pathname.endsWith("/chat/completions")) {
            urlObj.pathname = pathname.replace(/\/chat\/completions$/, "/models");
        } else if (pathname.endsWith("/v1")) {
            urlObj.pathname = pathname + "/models";
        } else if (!pathname.endsWith("/models")) {
            const suffix = provider === "cloud" && !pathname.includes("/v1") ? "/v1/models" : "/models";
            urlObj.pathname = pathname.replace(/\/+$/, "") + suffix;
        }

        return urlObj.toString();
    } catch {
        return urlStr;
    }
}

export function buildAuthHeaders(url: string, apiKey: string): Record<string, string> {
    if (!apiKey) return {};
    if (url.includes("openai.azure.com") || url.includes("api-version=")) {
        return { "api-key": apiKey };
    }
    return { Authorization: `Bearer ${apiKey}` };
}

function buildRequestBody(
    messages: Array<{ role: string; content: string }>,
    config: RequestRuntimeConfig,
    model: string,
    url: string
): Record<string, unknown> {
    const body: Record<string, unknown> = {
        model,
        messages,
        temperature: config.temperature,
        top_p: config.topP,
        stream: false
    };

    if (model.includes("o1-") || model.includes("gpt-5") || url.includes("api-version=2025-")) {
        body.max_completion_tokens = config.maxOutputTokens;
        body.temperature = 1;
        delete body.top_p;
    } else {
        body.max_tokens = config.maxOutputTokens;
    }

    return body;
}

async function fetchOpenAICompatible(
    endpoint: string,
    apiKey: string,
    body: Record<string, unknown>,
    options: LlmRequestOptions
): Promise<Response> {
    throwIfAborted(options.signal);

    if (shouldUseNetlifyProxy()) {
        return fetch(NETLIFY_PROXY_CHAT_PATH, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-user-api-key": apiKey
            },
            body: JSON.stringify({
                endpoint,
                model: body.model,
                messages: body.messages,
                params: {
                    temperature: body.temperature,
                    top_p: body.top_p,
                    max_tokens: body.max_tokens,
                    max_completion_tokens: body.max_completion_tokens,
                    stream: false
                }
            }),
            signal: options.signal
        });
    }

    return fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...buildAuthHeaders(endpoint, apiKey)
        },
        body: JSON.stringify(body),
        signal: options.signal
    });
}

async function parseOpenAIResponse(response: Response, model: string): Promise<string> {
    if (!response.ok) {
        await response.text().catch(() => "");

        if (response.status === 401) {
            throw new Error("Authentication failed: Invalid API key");
        }
        if (response.status === 429) {
            throw new Error("Rate limit exceeded. Please try again later.");
        }
        if (response.status === 404) {
            throw new Error(`Model "${model}" not found or endpoint incorrect`);
        }
        if (response.status >= 500) {
            throw new Error(`Server error (${response.status}). The API may be temporarily unavailable.`);
        }
        throw new Error(`API Error (${response.status}). The provider returned an error.`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
        if (data.choices?.[0]?.finish_reason === "content_filter") {
            throw new Error("Azure OpenAI Content Filter triggered. Please modify your prompt.");
        }
        throw new Error("No content in API response.");
    }

    return content;
}

const generateGenericOpenAIRequest = async (
    prompt: string,
    config: RequestRuntimeConfig,
    model: string,
    endpoint: string,
    apiKey: string,
    options: LlmRequestOptions = {}
): Promise<string> => {
    return retryWithBackoff(async () => {
        try {
            throwIfAborted(options.signal);
            const url = normalizeEndpointUrl(endpoint);
            const body = buildRequestBody([
                { role: "system", content: config.systemInstruction },
                { role: "user", content: prompt }
            ], config, model, url);
            const response = await fetchOpenAICompatible(url, apiKey, body, options);
            return await parseOpenAIResponse(response, model);
        } catch (error) {
            if (isAbortError(error)) {
                throw error;
            }
            if (error instanceof TypeError && error.message.includes("fetch")) {
                throw new Error(`Network error: Unable to connect to ${endpoint}. Please check your connection and endpoint URL.`);
            }
            throw error;
        }
    }, 3, 1000);
};

export async function fetchModelIds(
    endpoint: string,
    provider: ModelProvider,
    apiKey = "",
    options: LlmRequestOptions = {}
): Promise<string[]> {
    const modelsEndpoint = normalizeModelsEndpoint(endpoint, provider);

    const response = shouldUseNetlifyProxy()
        ? await fetch(NETLIFY_PROXY_MODELS_PATH, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-user-api-key": apiKey
            },
            body: JSON.stringify({ endpoint: modelsEndpoint }),
            signal: options.signal
        })
        : await fetch(modelsEndpoint, {
            headers: buildAuthHeaders(modelsEndpoint, apiKey),
            signal: options.signal
        });

    if (!response.ok) {
        throw new Error(`Model discovery failed (${response.status})`);
    }

    const data = await response.json();
    return Array.isArray(data.data) ? data.data.map((m: { id: string }) => m.id).filter(Boolean).sort() : [];
}

export function resolveJudgeRuntime(config: AppConfig, runConfig: RunConfiguration): JudgeRuntime {
    if (config.useMainModelAsJudge) {
        const provider = runConfig.provider;
        return {
            provider,
            model: runConfig.model,
            endpoint: provider === "cloud" ? config.cloudEndpoint : config.localEndpoint,
            apiKey: provider === "cloud" ? config.cloudApiKey : ""
        };
    }

    const provider = config.judgeProvider;
    return {
        provider,
        model: config.judgeModel,
        endpoint: config.judgeEndpoint || (provider === "cloud" ? config.cloudEndpoint : config.localEndpoint),
        apiKey: provider === "cloud" ? config.cloudApiKey : ""
    };
}

export function isJudgeRuntimeConfigured(config: AppConfig, runConfig?: RunConfiguration): boolean {
    if (config.useMainModelAsJudge) {
        return Boolean(runConfig?.model?.trim() && (runConfig.provider === "cloud" ? config.cloudEndpoint?.trim() : config.localEndpoint?.trim()));
    }
    const endpoint = config.judgeEndpoint || (config.judgeProvider === "cloud" ? config.cloudEndpoint : config.localEndpoint);
    return Boolean(config.judgeModel?.trim() && endpoint?.trim());
}

export interface EvaluationResult {
    score: number;
    note: string;
    criteriaScores?: Record<string, number>;
    comparedToReference?: boolean;
}

export const evaluateSummary = async (
    originalText: string,
    generatedSummary: string,
    criteria: JudgeCriteria[],
    provider: ModelProvider,
    model: string,
    endpoint: string,
    apiKey: string,
    referenceSummary?: string,
    options: LlmRequestOptions = {}
): Promise<EvaluationResult> => {
    throwIfAborted(options.signal);

    if (!originalText?.trim() || !generatedSummary?.trim()) {
        return {
            score: 0,
            note: "Evaluation failed: Missing original text or generated summary",
            comparedToReference: false
        };
    }

    if (!model?.trim() || !endpoint?.trim()) {
        return {
            score: 0,
            note: "Evaluation failed: Judge model or endpoint not configured",
            comparedToReference: false
        };
    }

    if (!criteria || criteria.length === 0) {
        return {
            score: 0,
            note: "Evaluation failed: No criteria defined",
            comparedToReference: false
        };
    }

    const hasReference = !!(referenceSummary && referenceSummary.trim().length > 0);

    let prompt = `You are an expert AI evaluator. Your task is to grade the quality of a generated summary.

Original Text:
"""
${originalText}
"""

Generated Summary:
"""
${generatedSummary}
"""
`;

    if (hasReference) {
        prompt += `
Reference Summary (Gold Standard):
"""
${referenceSummary}
"""

IMPORTANT: Compare the Generated Summary against both the Original Text AND the Reference Summary.
The Reference Summary represents high-quality output - use it as a benchmark for evaluation.
`;
    }

    prompt += `
Evaluation Criteria:
`;

    criteria.forEach(c => {
        prompt += `- ${c.name} (Weight: ${c.weight}%): ${c.description}\n`;
    });

    prompt += `
Instructions:
1. Evaluate the summary against each criterion.
2. Assign a score from 0 to 10 for EACH criterion individually.
3. Calculate the final weighted score (0-10).
4. Provide a brief explanation for the score.
${hasReference ? "5. Note how well the generated summary compares to the reference." : ""}

OUTPUT FORMAT:
You must return a valid JSON object in the following format:
{
  "score": <number_0_to_10>,
  "note": "<short_explanation>",
  "criteriaScores": {
${criteria.map(c => `    "${c.name}": <number_0_to_10>`).join(",\n")}
  }
}
`;

    let responseText = "";

    try {
        const judgeConfig: RequestRuntimeConfig = {
            systemInstruction: "You are a strict and precise evaluator. Output only valid JSON. No markdown formatting.",
            temperature: 0.1,
            maxOutputTokens: 1000,
            topP: 0.95
        };

        responseText = await generateGenericOpenAIRequest(prompt, judgeConfig, model, endpoint, apiKey, options);

        try {
            const jsonStr = responseText.replace(/```json\n?|\n?```/g, "").trim();
            const result = JSON.parse(jsonStr);

            const evaluationResult: EvaluationResult = {
                score: typeof result.score === "number" ? Math.min(10, Math.max(0, result.score)) : 0,
                note: result.note || "No explanation provided.",
                comparedToReference: hasReference
            };

            if (result.criteriaScores && typeof result.criteriaScores === "object") {
                evaluationResult.criteriaScores = {};
                for (const [key, value] of Object.entries(result.criteriaScores)) {
                    if (typeof value === "number") {
                        evaluationResult.criteriaScores[key] = Math.min(10, Math.max(0, value));
                    }
                }
            }

            return evaluationResult;
        } catch (error) {
            return {
                score: 0,
                note: `Error parsing evaluator response: ${error instanceof Error ? error.message : "Invalid JSON"}`,
                comparedToReference: hasReference
            };
        }
    } catch (error) {
        if (isAbortError(error)) {
            throw error;
        }
        return {
            score: 0,
            note: `Evaluation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            comparedToReference: hasReference
        };
    }
};
