
export const DEFAULT_MODEL_OPTIONS = [
  'model-small',
  'model-medium',
  'model-large',
  'model-reasoning'
] as const;

export type ModelProvider = 'local' | 'cloud';

export type PrivacyMode = 'off' | 'detect' | 'mask';
export type PrivacyRuntime = 'local-sidecar' | 'unavailable';
export type PrivacyCategory =
  | 'private_person'
  | 'private_address'
  | 'private_email'
  | 'private_phone'
  | 'private_url'
  | 'private_date'
  | 'account_number'
  | 'secret';

export type PrivacyCategoryConfig = Record<PrivacyCategory, boolean>;

export interface PrivacyFilterConfig {
  enabled: boolean;
  mode: PrivacyMode;
  runtime: PrivacyRuntime;
  sidecarEndpoint: string;
  categories: PrivacyCategoryConfig;
  minScore: number;
  blockOnUnavailable: boolean;
}

export interface PrivacySpan {
  start: number;
  end: number;
  label: PrivacyCategory;
  score: number;
  textPreview: string;
}

export interface PrivacyFilterResult {
  originalLength: number;
  maskedText: string;
  spans: PrivacySpan[];
  countsByCategory: Record<PrivacyCategory, number>;
  runtime: PrivacyRuntime;
  filteredAt?: number;
}

export interface PrivacyMetadata {
  masked: boolean;
  mode: PrivacyMode;
  runtime: PrivacyRuntime;
  countsByCategory: Record<PrivacyCategory, number>;
  originalLength: number;
  filteredAt: number;
}

export enum ToneType {
  PROFESSIONAL = 'Professional',
  CASUAL = 'Casual',
  ACADEMIC = 'Academic',
  CONCISE = 'Concise',
  WITTY = 'Witty'
}

export enum FormatType {
  PARAGRAPH = 'Paragraph',
  BULLET_POINTS = 'Bullet Points',
  EXECUTIVE_SUMMARY = 'Executive Summary',
  TLDR = 'TL;DR',
  JSON = 'JSON'
}

export interface AppConfig {
  provider: ModelProvider;
  activeModels: string[];
  modelVersion: string;
  // Cloud / BYOK Configuration
  cloudEndpoint: string;
  cloudApiKey: string;
  localEndpoint: string;
  temperature: number;
  topK: number;
  topP: number;
  maxOutputTokens: number;
  systemInstruction: string;
  tone: ToneType;
  format: FormatType;
  customFocus: string;
  maxWords: number;
  // New: Run Configurations for Batch Mode
  runConfigurations: RunConfiguration[];
  activeRunConfigs: string[]; // IDs of active configurations
  // LLM Judge Configuration
  judgeProvider: ModelProvider;
  judgeModel: string;
  judgeEndpoint: string; // Endpoint for Cloud API or Local LLM judge
  useMainModelAsJudge: boolean;
  judgeCriteria: JudgeCriteria[];
  // Local privacy minimization before any LLM call
  privacyFilter: PrivacyFilterConfig;
}

export interface JudgeCriteria {
  id: string;
  name: string;
  weight: number; // percentage (0-100)
  description: string;
}

export interface RunConfiguration {
  id: string;
  name: string;
  provider: ModelProvider;
  model: string;
  systemInstruction: string;
  temperature: number;
  topK: number;
  topP: number;
  maxOutputTokens: number;
  tone: ToneType;
  format: FormatType;
  customFocus: string;
  maxWords: number;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  sourceText: string;
  results: Record<string, string>;
  config: AppConfig;
  durationMs: number;
  privacy?: PrivacyMetadata;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

// --- New Batch & Evaluation Types ---

export type ViewMode = 'playground' | 'batch';

export type ValidationStatus = 'pending' | 'approved' | 'rejected';

export interface Evaluation {
  score: number; // 0-10
  note: string;
  isGroundTruth: boolean; // If true, this is the target for fine-tuning
  criteriaScores?: Record<string, number>; // Per-criterion scores (0-10)
  comparedToReference?: boolean; // Whether reference was used in grading
}

export interface BatchItem {
  id: string;
  title?: string;
  sourceText: string;
  referenceSummary?: string; // Master/ground-truth summary for comparison
  maskedSourceText?: string;
  maskedReferenceSummary?: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  results: Record<string, string>; // model -> generated text
  evaluations: Record<string, Evaluation>; // model -> grading details
  humanValidated?: ValidationStatus; // For SFT curation workflow
  error?: string;
  privacy?: PrivacyMetadata;
}
