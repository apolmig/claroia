import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

type PrivacyCategory =
    | 'private_person'
    | 'private_address'
    | 'private_email'
    | 'private_phone'
    | 'private_url'
    | 'private_date'
    | 'account_number'
    | 'secret'

type RedactRequest = {
    text?: string
    categories?: PrivacyCategory[]
    minScore?: number
    mode?: 'detect' | 'mask'
}

type PipelineOutput = {
    entity_group?: string
    entity?: string
    label?: string
    score?: number
    word?: string
    start?: number
    end?: number
}

type PrivacySpan = {
    start: number
    end: number
    label: PrivacyCategory
    score: number
    textPreview: string
}

class SidecarHttpError extends Error {
    statusCode: number

    constructor(statusCode: number, message: string) {
        super(message)
        this.statusCode = statusCode
    }
}

const CATEGORIES: PrivacyCategory[] = [
    'private_person',
    'private_address',
    'private_email',
    'private_phone',
    'private_url',
    'private_date',
    'account_number',
    'secret'
]

const DEFAULT_PORT = 8765
const MODEL_ID = 'openai/privacy-filter'
const MODEL_VERSION = 'openai/privacy-filter-q4'
const MAX_REDACT_BODY_BYTES = 1_000_000

let server: http.Server | null = null
let classifierPromise: Promise<any> | null = null
let classifierLoaded = false
let classifierError: string | undefined

const baseHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json'
}

const allowedOriginFor = (origin: string | string[] | undefined) => {
    const value = Array.isArray(origin) ? origin[0] : origin
    if (!value) return '*'
    if (value === 'null') return 'null'

    try {
        const parsed = new URL(value)
        if (parsed.protocol === 'file:') return value
        if (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
            return value
        }
    } catch {
        return undefined
    }

    return undefined
}

const headersFor = (req?: http.IncomingMessage) => {
    const allowedOrigin = allowedOriginFor(req?.headers.origin)
    return {
        ...baseHeaders,
        Vary: 'Origin',
        ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {})
    }
}

const getModelRoot = () => {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'privacy-filter-model')
    }

    return path.join(process.cwd(), 'privacy-filter-model')
}

const hasBundledModel = (modelRoot: string) =>
    fs.existsSync(path.join(modelRoot, MODEL_ID, 'config.json')) &&
    fs.existsSync(path.join(modelRoot, MODEL_ID, 'tokenizer.json')) &&
    fs.existsSync(path.join(modelRoot, MODEL_ID, 'onnx', 'model_q4.onnx')) &&
    fs.existsSync(path.join(modelRoot, MODEL_ID, 'onnx', 'model_q4.onnx_data'))

const importTransformers = async () => {
    const dynamicImport = new Function('specifier', 'return import(specifier)')
    return dynamicImport('@huggingface/transformers') as Promise<any>
}

const ensureClassifier = async () => {
    if (classifierPromise) return classifierPromise

    classifierPromise = (async () => {
        try {
            const modelRoot = getModelRoot()
            const transformers = await importTransformers()
            transformers.env.allowRemoteModels = false
            transformers.env.allowLocalModels = true
            transformers.env.localModelPath = modelRoot

            const classifier = await transformers.pipeline('token-classification', MODEL_ID, {
                dtype: 'q4',
                device: process.env.CLAROIA_PRIVACY_DEVICE || 'cpu',
                local_files_only: true
            })
            classifierLoaded = true
            return classifier
        } catch (error) {
            classifierError = error instanceof Error ? error.message : 'Failed to load bundled Privacy Filter model'
            classifierPromise = null
            throw error
        }
    })()

    return classifierPromise
}

const writeJson = (req: http.IncomingMessage | undefined, res: http.ServerResponse, statusCode: number, body: unknown) => {
    res.writeHead(statusCode, headersFor(req))
    res.end(JSON.stringify(body))
}

const readBody = async (req: http.IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
        const contentLength = Number(req.headers['content-length'] || 0)
        if (contentLength > MAX_REDACT_BODY_BYTES) {
            reject(new SidecarHttpError(413, `Request body is too large. Limit is ${MAX_REDACT_BODY_BYTES} bytes.`))
            return
        }

        const chunks: Buffer[] = []
        let received = 0
        req.on('data', chunk => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            received += buffer.length
            if (received > MAX_REDACT_BODY_BYTES) {
                req.destroy(new SidecarHttpError(413, `Request body is too large. Limit is ${MAX_REDACT_BODY_BYTES} bytes.`))
                return
            }
            chunks.push(buffer)
        })
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
    })

const normalizeCategory = (value: unknown): PrivacyCategory | null => {
    const raw = String(value || '')
        .replace(/^[BIES]-/, '')
        .replace(/^PRIVATE_/, 'private_')
        .toLowerCase()

    return CATEGORIES.includes(raw as PrivacyCategory) ? raw as PrivacyCategory : null
}

const locateSpan = (text: string, word: string, cursor: number) => {
    const trimmed = word.trim()
    if (!trimmed) return null

    const direct = text.indexOf(trimmed, cursor)
    if (direct >= 0) return { start: direct, end: direct + trimmed.length }

    const anywhere = text.indexOf(trimmed)
    if (anywhere >= 0) return { start: anywhere, end: anywhere + trimmed.length }

    return null
}

const toSpans = (
    output: PipelineOutput[],
    text: string,
    categories: Set<PrivacyCategory>,
    minScore: number
): PrivacySpan[] => {
    let cursor = 0

    return output
        .map(item => {
            const label = normalizeCategory(item.entity_group || item.entity || item.label)
            const score = Number(item.score ?? 1)

            if (!label || !categories.has(label) || score < minScore) return null

            let start = Number(item.start)
            let end = Number(item.end)

            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
                const located = locateSpan(text, String(item.word || ''), cursor)
                if (!located) return null
                start = located.start
                end = located.end
            }

            start = Math.max(0, Math.min(text.length, start))
            end = Math.max(start, Math.min(text.length, end))
            cursor = end

            return {
                start,
                end,
                label,
                score,
                textPreview: text.slice(start, Math.min(end, start + 64))
            }
        })
        .filter(Boolean) as PrivacySpan[]
}

const handleRedact = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const body = await readBody(req)
    const payload = JSON.parse(body || '{}') as RedactRequest
    const text = String(payload.text || '')
    const minScore = Number.isFinite(Number(payload.minScore)) ? Number(payload.minScore) : 0.5
    const categories = new Set(
        Array.isArray(payload.categories)
            ? payload.categories.filter(category => CATEGORIES.includes(category))
            : CATEGORIES
    )

    const classifier = await ensureClassifier()
    const raw = await classifier(text, { aggregation_strategy: 'simple' })
    const spans = toSpans(Array.isArray(raw) ? raw : [], text, categories, minScore)

    writeJson(req, res, 200, { spans })
}

export const startPrivacyFilterSidecar = () => {
    if (server) return

    const modelRoot = getModelRoot()
    if (!hasBundledModel(modelRoot)) return

    ensureClassifier().catch((): undefined => undefined)

    const port = Number(process.env.CLAROIA_PRIVACY_PORT || DEFAULT_PORT)
    server = http.createServer(async (req, res) => {
        try {
            if (req.method === 'OPTIONS') {
                if (!allowedOriginFor(req.headers.origin)) {
                    writeJson(req, res, 403, { error: 'Origin not allowed' })
                    return
                }
                res.writeHead(204, headersFor(req))
                res.end()
                return
            }

            if (!allowedOriginFor(req.headers.origin)) {
                writeJson(req, res, 403, { error: 'Origin not allowed' })
                return
            }

            const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)

            if (req.method === 'GET' && url.pathname === '/health') {
                writeJson(req, res, 200, {
                    version: MODEL_VERSION,
                    modelLoaded: classifierLoaded,
                    device: process.env.CLAROIA_PRIVACY_DEVICE || 'cpu',
                    labels: CATEGORIES,
                    modelPath: modelRoot,
                    error: classifierError
                })
                return
            }

            if (req.method === 'POST' && url.pathname === '/redact') {
                await handleRedact(req, res)
                return
            }

            writeJson(req, res, 404, { error: 'Not found' })
        } catch (error) {
            const statusCode = error instanceof SidecarHttpError ? error.statusCode : 500
            writeJson(req, res, statusCode, {
                error: error instanceof Error ? error.message : 'Privacy Filter sidecar error'
            })
        }
    })

    server.on('error', error => {
        classifierError = error instanceof Error ? error.message : 'Privacy Filter sidecar failed to start'
        server = null
    })

    server.listen(port, '127.0.0.1')
}

export const stopPrivacyFilterSidecar = () => {
    server?.close()
    server = null
}
