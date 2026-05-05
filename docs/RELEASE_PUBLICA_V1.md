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
- Alternative privacy-bundled Windows artifact: `dist-electron/release/ClaroIA-1.1.0-privacy-bundled-win-x64.zip`
- Netlify functions: `netlify/functions/`

## Required checks

Run before tagging or publishing:

```bash
npm audit --json
npm test -- --run
npx tsc --noEmit
npm run build:web
npm run build:desktop:win
npm run build:desktop:win:privacy-bundled
```

Expected state:

- `npm audit`: 0 vulnerabilities.
- Tests: all passing.
- TypeScript: no errors.
- Web build: succeeds.
- Windows ZIP: generated and does not include previous release artifacts recursively.
- Standard Windows ZIP: does not include `resources/privacy-filter-model`.
- Privacy-bundled Windows ZIP: includes `resources/privacy-filter-model/openai/privacy-filter/onnx/model_q4.onnx_data`.
- Privacy-bundled model download is pinned and verified against `scripts/privacy-filter-model-manifest.json`.
- Release upload workflow copies ZIP artifacts dynamically instead of hardcoding the package version.

## Manual smoke test

Desktop:

- Extract the ZIP in a clean folder.
- Launch `ClaroIA.exe`.
- Confirm the app opens without Node.js/npm.
- Import a small local CSV/TXT/PDF file created for the manual test.
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
- Enable Privacy Filter `Mask` mode with the sidecar stopped and confirm generation, judge, and export workflows are blocked.
- With the sidecar running, confirm source text and reference summaries are both masked before judge/export workflows.
- In the privacy-bundled desktop artifact, extract the ZIP, launch `ClaroIA.exe`, and confirm `GET http://127.0.0.1:8765/health` returns `openai/privacy-filter-q4`.
- In the privacy-bundled desktop artifact, post sample text with a name, email, and phone number to `/redact` and confirm `private_person`, `private_email`, and `private_phone` spans are returned.
- Confirm an oversized `/redact` body is rejected by the embedded sidecar.
- Generate results without masking, then enable `Mask` mode and confirm exports are blocked until the batch is re-run.
- Mark a Workbench item approved/rejected and confirm the filter chips and SFT export eligibility reflect the status.

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
- Standard Privacy Filter builds require a local loopback sidecar. The privacy-bundled desktop artifact starts an embedded loopback sidecar automatically when packaged model weights are present. `Mask` mode blocks instead of falling back to raw text if the sidecar is unavailable.
- The UI bundle currently emits a Vite chunk-size warning; this is not a release blocker.

## Suggested publication copy

ClaroIA v1.1.0 is a local-first LLM workbench for summarization, batch comparison, judge-based evaluation, and optional local Privacy Filter minimization. It ships as a Windows portable ZIP and as a Netlify BYOK demo, with privacy-first defaults and a hardened minimal backend.
