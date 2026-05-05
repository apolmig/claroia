# Privacy

ClaroIA is designed as a local-first BYOK workbench.

## API keys

- API keys are entered by the user at runtime.
- API keys are not stored in generation history snapshots.
- The Netlify demo forwards the key only in the `x-user-api-key` request header to the selected upstream endpoint.
- The Netlify backend does not persist request bodies, responses, or keys.

## Local storage

History is private/session-only by default. If the user enables saved history, the browser stores generation history in `localStorage`. Saved history can include source text, outputs, scores, and non-secret configuration values. Use **Clear local data** before sharing a machine or using sensitive content.

## Privacy Filter

ClaroIA can optionally call a local loopback Privacy Filter sidecar before generation. The privacy-bundled desktop artifact includes the q4 model weights and starts that sidecar automatically; the standard desktop ZIP expects an external local sidecar if filtering is enabled. Cloud calls are blocked by default when the filter is enabled but unavailable. In mask mode, ClaroIA is fail-closed: source text and reference summaries must be masked successfully before generation, judge, or export workflows can proceed. Results generated before a safe masked run are not exportable while mask mode is active. The app does not store a reversible re-identification map. This reduces exposure but is not legal anonymization or a compliance guarantee.

## Public demo

The public demo validates endpoints against an allowlist and rejects non-HTTPS/private-network endpoints. It does not perform server-side redaction because that would send raw text to the demo backend before filtering. Users remain responsible for the terms, costs, and privacy posture of their chosen model provider.
