# ClaroIA v1.1.0 public release

This document is the operational checklist for publishing ClaroIA v1.1.0.

## Release scope

- Windows portable ZIP artifact.
- Netlify BYOK demo.
- Local-first summarization and evaluation workbench.
- Supported imports: CSV, TXT, Markdown, JSON, PDF.
- Disabled imports: Excel `.xlsx/.xls` and DOCX.
- No project-owned LLM provider key in the public demo.

## Build outputs

- Web build: `dist/`
- Windows artifact: `dist-electron/release/ClaroIA-1.1.0-win-x64.zip`
- Netlify functions: `netlify/functions/`

## Required checks

Run before tagging or publishing:

```bash
npm audit --json
npm test -- --run
npx tsc --noEmit
npm run build:web
npm run build:desktop:win
```

Expected state:

- `npm audit`: 0 vulnerabilities.
- Tests: all passing.
- TypeScript: no errors.
- Web build: succeeds.
- Windows ZIP: generated and does not include previous release artifacts recursively.

## Manual smoke test

Desktop:

- Extract the ZIP in a clean folder.
- Launch `ClaroIA.exe`.
- Confirm the app opens without Node.js/npm.
- Import `examples/sample-batch.csv`.
- Run a local endpoint test if LM Studio or an OpenAI-compatible local server is available.
- Check that external Markdown links open in the system browser and do not navigate the app window.
- Confirm Excel and DOCX show the disabled-format message.
- Confirm PDF import works offline with the bundled worker.

Netlify:

- Deploy a preview.
- Confirm `/api/health` returns OK.
- Confirm `/api/chat` rejects missing `x-user-api-key`.
- Confirm non-HTTPS, localhost/private, and non-allowlisted endpoints are rejected.
- Test a valid BYOK request against OpenAI/OpenRouter/Groq/DeepSeek as configured.

Privacy:

- Confirm history is private/session-only by default.
- Enable saved history and verify only non-secret config is persisted.
- Use **Clear local data** and verify history and API key are removed.

## Environment

Netlify build:

```bash
VITE_APP_MODE=netlify
NETLIFY_ALLOWED_ENDPOINTS=https://api.openai.com/v1,https://openrouter.ai/api/v1,https://api.groq.com/openai/v1,https://api.deepseek.com
```

Do not configure provider API keys as public environment variables.

## Known limits

- Windows artifact is unsigned in v1.
- Public demo is BYOK and may be limited by user provider quota.
- DOCX and Excel import are intentionally disabled until a safer parsing strategy is selected.
- The UI bundle currently emits a Vite chunk-size warning; this is not a release blocker.

## Suggested publication copy

ClaroIA v1.1.0 is a local-first LLM workbench for summarization, batch comparison, judge-based evaluation, and optional local Privacy Filter minimization. It ships as a Windows portable ZIP and as a Netlify BYOK demo, with privacy-first defaults and a hardened minimal backend.
