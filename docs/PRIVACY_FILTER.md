# Privacy Filter integration

ClaroIA v1.1 adds an optional local privacy minimization layer before sending text to any LLM.

The integration is designed for OpenAI Privacy Filter, an Apache 2.0 open-weight model for PII detection and masking. ClaroIA does not bundle the model weights in the main ZIP. Instead, it expects an optional local loopback sidecar.

## Security model

- Filtering is local-first.
- The public Netlify demo does not redact server-side.
- The expected sidecar endpoint must be a local HTTP loopback URL such as `http://127.0.0.1:8765`.
- Cloud calls are blocked by default when the filter is enabled and the sidecar is unavailable. In `Mask before LLM` mode, all calls are blocked if the sidecar is unavailable.
- `Mask` mode is fail-closed: ClaroIA never falls back to sending original text when masking fails, even if blocking is disabled for detect-only workflows.
- Batch source text and reference summaries are treated as separate privacy surfaces. Both must be scanned and masked before judge/export workflows can use them in `Mask` mode.
- Generated outputs are tied to the privacy state used at generation time. Exports and manual judge runs are blocked when an output was produced before a safe masked run.
- Masking is irreversible in ClaroIA v1.1. The app does not store or export a re-identification map.

## Modes

- `Off`: no filtering.
- `Detect`: scan text and show category counts, but send original text.
- `Mask`: replace detected spans with placeholders before generation, judge, history persistence, and dataset export.

## Categories

The UI exposes the native OpenAI Privacy Filter taxonomy:

- `private_person`
- `private_address`
- `private_email`
- `private_phone`
- `private_url`
- `private_date`
- `account_number`
- `secret`

## Sidecar contract

Health check:

```http
GET /health
```

Expected response:

```json
{
  "version": "0.1.0",
  "modelLoaded": true,
  "device": "cpu",
  "labels": ["private_email", "private_person"]
}
```

Redaction:

```http
POST /redact
Content-Type: application/json
```

Request:

```json
{
  "text": "Email alice@example.com",
  "categories": ["private_email", "secret"],
  "minScore": 0.5,
  "mode": "mask"
}
```

Response:

```json
{
  "spans": [
    {
      "start": 6,
      "end": 23,
      "label": "private_email",
      "score": 0.99,
      "textPreview": "alice@example.com"
    }
  ]
}
```

ClaroIA performs masking client-side from spans, so the sidecar does not need to return masked text.

## Workflow behavior

- Playground generation sends only masked text when mode is `Mask`.
- Saved history stores the masked source text when masking is active.
- Batch generation filters each item before generation.
- LLM Judge evaluates the masked source, masked reference, and generated output.
- CSV/JSONL/SFT/RL/DPO exports include privacy metadata and use masked source and masked reference text after the batch has been processed or scanned.
- If Privacy Filter is in `Mask` mode and batch items have not been scanned/processed, exports are blocked to avoid leaking unfiltered source or reference text.
- If results were generated before enabling `Mask` mode, exports are blocked until the batch is re-run with masking enabled. This avoids exporting stale outputs that may contain copied PII.

## Limitations

Privacy Filter reduces exposure; it is not legal anonymization, a compliance certification, or a substitute for policy review. Model misses and false positives are possible, especially for uncommon identifiers, non-English text, domain-specific identifiers, or high-sensitivity workflows.
