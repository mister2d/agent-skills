# Tika REST API — Endpoint Reference

All endpoints accept the file as the raw PUT body. Base URL is configured per the SKILL.md.

---

## `/detect`

**Method:** PUT  
**Purpose:** Identify the MIME type of a file without extracting any content.  
**When to use:** When you have a headerless or misnamed file and need its true type before deciding
what to do with it.

**Response:** `text/plain` — a single MIME type string, e.g. `application/pdf`

**Notes:** Integrates Google Magika (in the 3.x branch) for AI-assisted detection of obscure or
headerless files. Faster and cheaper than `/meta` when you only need the type.

---

## `/meta`

**Method:** PUT (body) or GET (with `?url=` query param for remote URLs)  
**Purpose:** Return all metadata without extracting the full text.  
**When to use:** Fast triage — determine file type, language, author, page count, embedded object
count, creation/modification dates, and any exception flags before committing to full extraction.

**Accept options:**

| Accept | Response format |
|---|---|
| `application/json` | JSON object (recommended for agents) |
| `text/csv` | CSV key-value pairs |
| `text/plain` | Raw metadata dump |

**Key response fields (JSON):**

```json
{
  "Content-Type": "application/pdf",
  "dc:creator": "Jane Smith",
  "dcterms:created": "2024-03-15T10:22:00Z",
  "meta:page-count": "42",
  "meta:word-count": "18430",
  "Content-Language": "en",
  "X-TIKA:EXCEPTION:warn": "...",
  "embeddedResourceTable": { ... }
}
```

**Useful detection signals in metadata:**

- `encryption` key present → file is likely encrypted/DRM-protected
- `meta:page-count` very high → consider chunking before LLM ingestion
- `Content-Type` differs from file extension → Tika has overridden the declared type; trust Tika
- `embeddedResourceTable` present → compound document; use `/rmeta` for full traversal

---

## `/tika`

**Method:** PUT  
**Purpose:** Extract the full text content of a document.  
**When to use:** The primary text extraction endpoint for single documents destined for LLM input.

**Accept options:**

| Accept | Response | Best for |
|---|---|---|
| `text/plain` | Clean plain text | LLM consumption, chunking pipelines |
| `text/html` | Structured HTML with headings/tables | Preserving layout, table extraction |
| `text/xml` | XHTML with semantic markup | Structured parsing, XPath queries |

**OCR behavior:** When the file is an image or an image-based PDF, Tika automatically invokes
Tesseract. No extra configuration needed. Use `X-Tika-OCRLanguage` header to hint the language.

**PDF-specific headers:**

| Header | Value | Effect |
|---|---|---|
| `X-Tika-PDFextractInlineImages` | `true` | OCR images embedded inline in PDF pages |
| `X-Tika-PDFOcrStrategy` | `ocr_only` / `no_ocr` / `auto` | Control OCR strategy |

**Example curl:**
```bash
curl -X PUT \
  -H "Content-Type: application/pdf" \
  -H "Accept: text/plain" \
  --data-binary @document.pdf \
  ${TIKA_BASE_URL:-https://tika.service.internal.novuscotia.com}/tika
```

---

## `/rmeta`

**Method:** PUT  
**Purpose:** Recursively extract text and metadata from all objects in a compound document.
Returns a JSON array where `[0]` is the container/parent and `[1…N]` are embedded children.  
**When to use:** Any time the triage metadata hints at embedded objects: email with attachments,
ZIP archives, DOCX with embedded Excel, PDF with attached files, OLE compound documents (`.msg`).

**Accept:** `application/json` (only meaningful option for agents)

**Response shape:**

```json
[
  {
    "Content-Type": "message/rfc822",
    "dc:subject": "Q3 Report",
    "X-TIKA:content": "Body text of the email...",
    "resourceName": "email.eml"
  },
  {
    "Content-Type": "application/pdf",
    "dc:creator": "Finance Team",
    "X-TIKA:content": "Text extracted from attached PDF...",
    "resourceName": "Q3_Report.pdf",
    "embeddedRelationshipId": "attachment-1"
  },
  {
    "Content-Type": "image/png",
    "X-TIKA:content": "OCR text if any...",
    "resourceName": "chart.png",
    "embeddedRelationshipId": "attachment-2"
  }
]
```

**Key fields per child object:**

| Field | Meaning |
|---|---|
| `X-TIKA:content` | Extracted text (or OCR output) for this object |
| `Content-Type` | True MIME type of this child |
| `resourceName` | Original filename of the embedded object |
| `embeddedRelationshipId` | Position identifier within the parent |
| `X-TIKA:EXCEPTION` | Parser error for this specific child (non-fatal) |

**Controlling recursion depth:**

| Header | Value | Effect |
|---|---|---|
| `X-Tika-Skip-Embedded` | `true` | Suppress child traversal entirely |
| `X-Tika-Embed-Exception` | `true` | Include exception detail per child |

**Macro extraction:** VBA macros in Office files appear as children with
`Content-Type: text/x-vba`. Their `X-TIKA:content` is the raw macro source code.

---

## `/unpack`

**Method:** PUT  
**Purpose:** Extract raw embedded assets as a multipart response — actual file bytes, not text.  
**When to use:** When a downstream tool needs the actual image, Excel, or PDF bytes extracted
from a compound document (e.g. to pipe an extracted chart to a VLM, or to save attachments).

**Variants:**

| Endpoint | Behavior |
|---|---|
| `/unpack` | Extracts the primary/first embedded object |
| `/unpack/all` | Returns all embedded objects as a multipart/mixed response |

**Response:** `multipart/mixed` — each part has its own `Content-Type` and `Content-Disposition`
headers with the original filename.

**Example use case:** Extract all images from a DOCX to pass to a vision model.

```bash
curl -X PUT \
  -H "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document" \
  -H "Accept: */*" \
  --data-binary @report.docx \
  ${TIKA_BASE_URL:-https://tika.service.internal.novuscotia.com}/unpack/all \
  --output assets.tar
```

The response is a tar archive by default when multiple files are present.

---

## `/language`

**Method:** PUT  
**Purpose:** Detect the human language of the submitted text (not a document — send plain text).  
**When to use:** When you have already extracted text via `/tika` and want a language label without
re-parsing the full document. Slightly more efficient than reading `Content-Language` from `/meta`.

**Response:** `text/plain` — ISO 639-1 language code, e.g. `en`, `fr`, `de`, `zh`

---

## Health & Status Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/tika` | GET | Returns Tika version info (HTML) |
| `/version` | GET | Returns version string |
| `/mime-types` | GET | Returns all supported MIME types as JSON |

Use `/version` and `/mime-types` for integration smoke tests after container startup.
