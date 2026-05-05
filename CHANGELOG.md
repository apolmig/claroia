# Changelog

## 1.1.1-unreleased - Privacy-bundled artifact

### Added

- Alternative Windows privacy-bundled release path that packages OpenAI Privacy Filter q4 ONNX assets.
- Electron-owned loopback Privacy Filter sidecar for bundled PII detection and masking at `http://127.0.0.1:8765`.
- Separate electron-builder config for the privacy-bundled ZIP so the standard Windows artifact does not carry model weights.

## 1.1.0 - Privacy Filter integration

### Added

- Optional local Privacy Filter configuration for detect-only and mask-before-LLM workflows.
- Local loopback sidecar contract for `/health` and `/redact`.
- Privacy metadata on history, batch items, judge notes, and dataset exports.
- Batch “Scan privacy” action and UI controls for categories, sensitivity, and cloud blocking.
- Documentation for Privacy Filter setup, behavior, and limitations.

### Security

- Cloud calls are blocked by default when mask mode is enabled and the local sidecar is unavailable.
- Public Netlify demo does not perform server-side redaction, avoiding raw-text upload before filtering.
- Masking is irreversible in the app; no re-identification map is stored or exported.

## 1.0.0 - Public release

### Added

- Windows portable ZIP release target.
- Netlify BYOK demo with `chat`, `models`, and `health` functions.
- Public article and release checklist under `docs/`.
- Example non-sensitive batch dataset.
- Privacy, security, license, and environment-template documentation.

### Changed

- History persistence is opt-in; default mode is private/session-only.
- LLM requests support abort signals so stopped batch jobs cancel in-flight calls.
- Judge runtime resolution is shared across batch and manual evaluation.
- PDF.js worker is bundled locally instead of loaded from a CDN.
- Electron runtime is sandboxed and blocks untrusted navigation.
- Netlify endpoint allowlisting uses parsed URL origin/path checks.

### Security

- `npm audit` reports 0 vulnerabilities for the full dependency tree at release time.
- Excel and DOCX import are disabled in the public build because previous parsers had unresolved high-severity advisories.
- Netlify functions enforce request size, message count/length, upstream timeout, HTTPS-only endpoints, private-network rejection, and basic IP rate limiting.
- API keys are not persisted in history snapshots.
