---
name: tika-analyst
description: >
  Expert skill for document intelligence tasks powered by a self-hosted Apache Tika instance.
  Use this skill whenever the agent needs to: extract text from any file (PDF, DOCX, PPTX, XLSX,
  email, EPUB, archive, image, video, audio, geospatial, or any other format); detect MIME types
  or file metadata; recursively unpack compound documents like ZIP archives, EML emails with
  attachments, or embedded Office OLE objects; run OCR on scanned PDFs or images; detect document
  language; audit documents for embedded macros; or extract raw embedded assets such as images and
  charts from Word docs or PDFs. Also trigger for any workflow that needs to triage unknown file
  types before deciding how to process them, or that needs to feed clean text into a downstream LLM.
  Always prefer this skill over ad-hoc file parsing — Tika handles 1,400+ MIME types deterministically
  and Tesseract OCR is included in the deployed full container.
---

# Apache Tika Analyst Skill

## Configuration

The Tika server base URL must be set before any API call. Check these sources in order:

1. An environment variable `TIKA_BASE_URL` if set
2. A tool config or agent context that specifies the Tika endpoint
3. Fall back to asking the agent's operator; **never silently assume `localhost`**

All endpoints below are relative to this base URL (e.g. `http://tika.service.internal:9998`).

> For detailed endpoint reference and header options, read `references/endpoints.md`.
> For MIME-type-based routing heuristics, read `references/routing-guide.md`.

---

## Core Principle: Triage First

Always call `/meta` before committing to heavy extraction. The metadata response is fast, cheap, and
tells you: the true MIME type (Tika overrides the file extension), embedded object count, author,
creation date, and whether the file is likely to be compound (archive, email, encrypted). Use that
signal to choose the right follow-up endpoint.

**Exception:** If the task is purely "extract text from this known-good PDF/DOCX", skip triage and
go straight to `/tika`.

---

## Endpoint Decision Tree

```
Task received
│
├── "What is this file?" / "Triage before processing"
│     └── GET /meta?url=... or PUT /meta with body
│           Returns: JSON metadata blob → decide next action
│
├── "Extract text for LLM consumption"
│     └── PUT /tika  (Accept: text/plain)
│           Best for: single-file PDFs, DOCX, PPTX, HTML, EPUB, RTF
│           If file is an image or scanned PDF → Tesseract fires automatically
│
├── "Compound document" (ZIP, EML, MSG, OLE, nested archives)
│     └── PUT /rmeta  (Accept: application/json)
│           Returns: JSON array; index 0 is the parent, 1…N are embedded children
│           Each child has its own X-TIKA:content and metadata fields
│           Use this for: email + attachments, docx with embedded Excel, ZIP trees
│
├── "Pull out raw embedded files" (images, charts, attachments as bytes)
│     └── PUT /unpack  or  PUT /unpack/all
│           Returns: multipart response — one part per extracted asset
│           Use this when downstream needs the actual file bytes, not just text
│
└── "Security / macro audit"
      └── PUT /rmeta  (macros extracted by default in 3.3.x)
            Look for X-TIKA:EXCEPTION or VBA content in child objects
```

---

## Workflow Patterns

### Pattern 1 — Single Document → LLM Pipeline

```
1. PUT /meta          → confirm MIME, check Content-Encoding for encryption signals
2. PUT /tika          → extract plain text (Accept: text/plain)
3. Chunk text         → feed to LLM
```

For structured extraction where document layout matters (tables, headings), use `Accept: text/html`
instead of `text/plain` — Tika preserves structural markup that helps LLMs parse tables.

### Pattern 2 — Compound Document / Archive Traversal

```
1. PUT /rmeta  →  receive JSON array
2. Parse array:
   - items[0]           = parent container metadata
   - items[1…N]         = child objects (may be nested)
   - each item has:
       "X-TIKA:content"           → extracted text of that object
       "Content-Type"             → MIME of that specific child
       "resourceName"             → original filename
       "embeddedRelationshipId"   → position in parent structure
3. Route each child by Content-Type (see references/routing-guide.md)
4. For image children → pass X-TIKA:content (OCR text) or use /unpack for raw bytes
```

### Pattern 3 — Scanned PDF / Image OCR

No extra steps required. Sending any image or image-based PDF to `/tika` automatically
invokes Tesseract. If OCR quality is poor, check `X-TIKA:EXCEPTION` in the metadata
response — it surfaces Tesseract errors (missing language pack, corrupt raster, etc.).

### Pattern 4 — Language Detection

`/tika` responses include the `Content-Language` header (or `language` in `/meta` JSON).
Use this for: routing multilingual documents to the right LLM prompt, deciding whether to
transliterate before chunking, or flagging unexpected languages for human review.

### Pattern 5 — Security / Macro Audit

```
1. PUT /rmeta  on the Office file
2. Scan all child items for:
   - Content-Type: text/x-vba         → VBA macro source code present
   - Content-Type: application/x-ms-office-activex → ActiveX control
   - X-TIKA:EXCEPTION fields          → parsing anomalies worth flagging
3. Surface the extracted macro text to the agent for code inspection
```

---

## Request Conventions

All PUT requests should send the raw file bytes as the request body.

**Minimum required headers:**

| Header | Value |
|---|---|
| `Content-Type` | The file's MIME type, or `application/octet-stream` if unknown |
| `Accept` | Desired response format (see endpoint reference) |

**Useful optional headers:**

| Header | Purpose |
|---|---|
| `X-Tika-OCRLanguage` | Hint Tesseract language (e.g. `eng+fra`) |
| `X-Tika-PDFextractInlineImages` | `true` to OCR inline images inside PDFs |
| `X-Tika-Skip-Embedded` | `true` to suppress child recursion on `/rmeta` |

---

## Interpreting Errors

| Signal | Meaning | Action |
|---|---|---|
| HTTP 422 | Tika parsed the file but found no extractable content | Check if file is encrypted or DRM-protected |
| HTTP 415 | MIME type explicitly unsupported | Fall back to `/detect` to identify type, then retry |
| `X-TIKA:EXCEPTION` in JSON | Parser threw during extraction | Partial content may still be usable; log the exception |
| Empty `X-TIKA:content` | File parsed but no text layer | File is likely image-only; ensure OCR is enabled |
| HTTP 500 | Tika server-side crash | Retry once; if persistent, check container health |

---

## Output Conventions

When reporting Tika results to a user or downstream agent:

- **Metadata triage**: Present as a concise fact sheet — MIME type, creation date, author,
  page/word count, language detected, and any exception flags. Do not dump the raw JSON blob.
- **Extracted text**: Do not truncate silently. If text exceeds context window limits, state the
  character count, chunk strategy used, and which chunk is being presented.
- **Compound document tree**: Summarize the inventory first (e.g. "3 embedded images, 1 PDF
  attachment, 2 Excel sheets") before presenting content, so the user understands the structure.
- **Errors**: Always surface `X-TIKA:EXCEPTION` values — they are diagnostic signals, not noise.

---

## Reference Files

Read these as needed — they are not required for every task:

- **`references/endpoints.md`** — Full endpoint reference: all routes, headers, Accept types,
  example curl commands, and response shape details. Read when you need header specifics or
  are working with a less common endpoint (`/detect`, `/language`, `/translate`).

- **`references/routing-guide.md`** — MIME-type routing table and compound document heuristics.
  Read when you receive an unfamiliar MIME type and need to decide the right extraction strategy,
  or when the triage metadata is ambiguous.
