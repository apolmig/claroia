# ClaroIA

ClaroIA is a local-first LLM summarization and evaluation workbench. It runs as a Windows portable desktop app and as a Netlify BYOK demo for OpenAI-compatible providers.

## Demo

<p align="center">
  <a href="https://youtu.be/H-uIokuW15o">
    <img src="https://img.youtube.com/vi/H-uIokuW15o/maxresdefault.jpg" alt="ClaroIA demo video" width="100%">
  </a>
</p>

[Watch the demo on YouTube](https://youtu.be/H-uIokuW15o)

## Public release

Current public release: `v1.1.0`.

Release materials:

- [Public article in Spanish](docs/ARTICULO_PUBLICO_ES.md)
- [Public release checklist](docs/RELEASE_PUBLICA_V1.md)
- [Privacy Filter integration](docs/PRIVACY_FILTER.md)
- [Changelog](CHANGELOG.md)
- [Privacy](PRIVACY.md)
- [Security](SECURITY.md)

## What it does

- Playground: summarize one text with one or more selected models.
- Workbench: process `.txt`, `.csv`, `.pdf`, `.json`, and `.md` batches.
- Compare runs: define multiple run configurations and view outputs side by side.
- Judge outputs: score summaries with configurable weighted criteria and optional reference summaries.
- Privacy Filter: optionally detect or fail-closed mask PII locally before LLM calls.
- Export datasets: CSV, JSONL, SFT/RL/DPO-style exports for downstream workflows.

## Public v1 modes

### Windows portable artifact

The Windows release is built as a portable Electron artifact. End users do not need Node.js, npm, or a package manager.

```bash
npm run release:win
```

Artifacts are written to `dist-electron/release/`.

An alternative privacy-bundled artifact includes the OpenAI Privacy Filter q4 ONNX weights and starts the local masking sidecar automatically:

```bash
npm run release:win:privacy-bundled
```

That ZIP is larger because it carries the local PII detection model under the packaged app resources.

The standard `release:win` artifact omits the model weights. The privacy-bundled build uses `electron-builder.privacy-bundled.cjs` so the two release paths stay separate. The model download is pinned to a Hugging Face commit and verified against `scripts/privacy-filter-model-manifest.json` before packaging.

### Netlify BYOK demo

The Netlify demo is static Vite frontend plus minimal Functions:

- `netlify/functions/chat.ts` proxies chat completions.
- `netlify/functions/models.ts` proxies model discovery.
- `netlify/functions/health.ts` exposes a health check.

Users provide their own API key at runtime. The demo does not use or store a project-owned provider key.

```bash
npm run build:web
npx netlify deploy
```

Netlify config is in `netlify.toml`. Configure endpoint allowlisting with:

```bash
NETLIFY_ALLOWED_ENDPOINTS=https://api.openai.com/v1,https://openrouter.ai/api/v1
```

## Development

### Prerequisites

- Node.js 20.16+
- npm

### Install

```bash
npm install
```

### Run web app

```bash
npm run dev
```

### Build web app

```bash
npm run build:web
```

### Run tests

```bash
npm test -- --run
```

### Run desktop app in development

```bash
npm run electron:dev
```

## Configuration

Copy `.env.example` to `.env` if you want local defaults:

```bash
VITE_APP_MODE=local
VITE_DEFAULT_CLOUD_ENDPOINT=https://openrouter.ai/api/v1
VITE_DEFAULT_LOCAL_ENDPOINT=http://localhost:1234/v1/chat/completions
```

Do not put provider API keys in `VITE_*` variables. Keys are runtime user input.

## Endpoint support

ClaroIA expects OpenAI-compatible APIs. It normalizes common endpoint forms:

- `/v1`
- `/models`
- `/chat/completions`

The public Netlify demo allows only HTTPS endpoints from `NETLIFY_ALLOWED_ENDPOINTS` and rejects localhost/private network endpoints. The desktop/local app can still call local endpoints such as LM Studio at `http://localhost:1234/v1/chat/completions`.

## Privacy and security

- API keys are not saved to history snapshots.
- History is private/session-only by default.
- If users enable saved history, source text and model outputs are stored in browser `localStorage`.
- Use **Clear local data** in the UI before sharing a machine or working with sensitive data.
- Privacy Filter can mask PII before LLM calls using an optional local loopback sidecar; the alternative privacy-bundled desktop artifact includes the model weights and starts that sidecar automatically. In mask mode, ClaroIA blocks instead of falling back to raw text if masking fails.
- Batch source text and reference summaries are masked independently, and exports are blocked unless generated outputs are tied to a safe masked run. Batch rows can be marked pending, approved, or rejected before SFT export.
- The embedded Privacy Filter sidecar rejects oversized redact requests before buffering them in memory.
- Excel `.xlsx/.xls` and DOCX import are disabled in the public build because previous client-side parsers had unresolved high-severity audit findings. Use CSV, TXT, Markdown, JSON, or PDF.
- The Windows v1 artifact is unsigned unless a future release adds code signing.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
