# Security Policy

## Supported version

Security fixes target the current `main` branch and the latest public release artifact.

## Reporting

Open a private security advisory or contact the maintainers before publishing details. Include:

- Affected version or commit.
- Reproduction steps.
- Expected and actual impact.
- Whether secrets, prompts, uploaded files, or model outputs can be exposed.

## Security model

- The desktop artifact is local-first and sends requests only to endpoints configured by the user.
- The Netlify demo is BYOK and uses a small proxy only to avoid CORS and enforce endpoint allowlisting.
- Privacy Filter integration is local-sidecar only; server-side redaction is intentionally not used in the public demo.
- When Privacy Filter is enabled, cloud calls are blocked by default if the local sidecar is unavailable; in mask mode all calls are blocked until filtering succeeds.
- In batch mode, source text, reference summaries, generated outputs, judge calls, and exports are checked against the privacy state used for generation. Exports are blocked if outputs were produced before a safe masked run.
- Do not commit provider API keys, private datasets, or generated outputs containing sensitive data.

## Known limits

- Windows artifacts are unsigned in v1.
- Local browser history is session-only by default; persistent history is opt-in and persists until the user clears it.
- Users must trust their configured LLM endpoints.
- Privacy Filter reduces exposure but is not a compliance certification or legal anonymization guarantee.
