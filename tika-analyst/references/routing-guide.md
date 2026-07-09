# Tika Routing Guide — MIME Types & Compound Document Heuristics

Use this reference when `/meta` triage returns an unfamiliar MIME type and you need to decide
the best extraction strategy, or when the file's content structure is ambiguous.

---

## Quick Routing Table

| MIME Type | Use Endpoint | Notes |
|---|---|---|
| `application/pdf` | `/tika` | OCR fires automatically if image-based |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `/tika` or `/rmeta` | Use `/rmeta` if you need embedded images/objects |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `/tika` (HTML Accept) | `text/html` preserves table structure better than plain |
| `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `/tika` | Each slide extracted in sequence |
| `application/vnd.ms-excel` | `/tika` (HTML Accept) | Legacy XLS; same table caveat as XLSX |
| `application/vnd.ms-powerpoint` | `/tika` | Legacy PPT |
| `application/msword` | `/tika` or `/rmeta` | Legacy DOC; may contain embedded OLE objects |
| `message/rfc822` | `/rmeta` | EML email — always use rmeta to get attachments |
| `application/vnd.ms-outlook` | `/rmeta` | MSG (Outlook binary) — compound by nature |
| `application/zip` | `/rmeta` | Traverse the full archive tree |
| `application/x-tar` | `/rmeta` | Same as ZIP |
| `application/gzip` | `/rmeta` | Tika decompresses and recurses |
| `application/x-7z-compressed` | `/rmeta` | 7-Zip support in full container |
| `application/epub+zip` | `/tika` | EPUB is a ZIP but Tika surfaces text cleanly |
| `text/html` | `/tika` | Strips tags; use HTML Accept to preserve structure |
| `text/xml` | `/tika` | Content extracted; structure depends on XML schema |
| `application/xml` | `/tika` | Same as text/xml |
| `application/json` | `/tika` | Text/values extracted from JSON fields |
| `application/rtf` | `/tika` | Rich Text Format; full text extraction |
| `image/jpeg` | `/tika` | Tesseract OCR; also EXIF metadata via /meta |
| `image/png` | `/tika` | Tesseract OCR |
| `image/tiff` | `/tika` | Tesseract handles multi-page TIFF |
| `image/webp` | `/tika` | OCR + metadata |
| `application/vnd.oasis.opendocument.text` | `/tika` | LibreOffice ODT |
| `application/vnd.oasis.opendocument.spreadsheet` | `/tika` (HTML) | LibreOffice ODS |
| `application/vnd.oasis.opendocument.presentation` | `/tika` | LibreOffice ODP |
| `audio/mpeg` | `/meta` | Text extraction not meaningful; use /meta for ID3 tags |
| `audio/flac` | `/meta` | Same — metadata only |
| `video/mp4` | `/meta` | Container metadata (duration, codec, dimensions) |
| `video/x-matroska` | `/meta` | MKV; metadata + chapter structure |
| `application/vnd.google-earth.kml+xml` | `/tika` | KML geospatial; text content extracted |
| `image/geotiff` | `/meta` + `/tika` | GDAL-backed; spatial metadata + any embedded text |
| `application/vnd.lotus-notes` | `/rmeta` | NSF (Lotus Notes) — compound |
| `application/x-ms-shortcut` | `/meta` | LNK files; metadata reveals target path |
| `application/x-msdownload` | `/meta` | EXE/DLL — extract PE headers only, no text |
| `application/octet-stream` | `/detect` first | Unknown binary; detect before routing |

---

## Compound Document Heuristics

When `/meta` returns these signals, treat the file as compound and use `/rmeta`:

```
embeddedResourceTable is present and non-empty     → compound, use /rmeta
Content-Type is message/*                          → always compound (email)
Content-Type is application/zip or similar archive → always compound
meta:object-count > 0                              → embedded OLE objects present
Content-Type is application/vnd.ms-outlook         → MSG file, always compound
```

When in doubt, use `/rmeta` — it gracefully handles non-compound files by returning a
single-element array, so there is no penalty for over-routing.

---

## Office Document Decision Tree

```
File is .docx / .xlsx / .pptx?
│
├── Task: "Extract text for LLM"
│     └── /tika  (Accept: text/plain)
│
├── Task: "Extract text preserving tables/layout"
│     └── /tika  (Accept: text/html)
│
├── Task: "Get embedded images / charts / objects"
│     └── /rmeta  →  filter children by Content-Type: image/*
│         then /unpack/all for raw bytes if needed
│
├── Task: "Audit for macros"
│     └── /rmeta  →  filter children by Content-Type: text/x-vba
│
└── Task: "Check file origin / authorship"
      └── /meta  →  look at dc:creator, dcterms:created, meta:last-author
```

---

## PDF-Specific Routing

```
Is the PDF text-based or image-based?
│
├── /meta returns meta:page-count but no word count → likely image-based
│     └── /tika with X-Tika-PDFextractInlineImages: true
│           Tesseract runs automatically per page
│
├── /meta returns both page-count and word-count → text layer present
│     └── /tika  (Accept: text/plain or text/html for tables)
│
├── PDF has embedded attachments (Portfolio PDF / PDF/A with attachments)
│     └── /rmeta  →  children include the attached files
│
└── XFA-based PDF (legacy interactive forms)
      └── /tika — improved parsing in 3.2.x+; form fields extracted as text
```

---

## Audio / Video: Metadata-Only Files

For audio and video, text extraction is not meaningful. The value from Tika for these formats
is metadata extraction via `/meta`:

**Audio fields of interest:** `xmpDM:artist`, `xmpDM:album`, `xmpDM:genre`, `xmpDM:duration`,
`xmpDM:audioSampleRate`, `xmpDM:audioChannelType`, embedded lyrics (`dc:description`)

**Video fields of interest:** `xmpDM:duration`, `tiff:ImageWidth`, `tiff:ImageLength`,
`xmpDM:videoFrameRate`, `xmpDM:audioSampleRate`, container format, codec identifiers

If the task involves finding spoken-word content in a video/audio file, Tika cannot help —
route to a speech-to-text system instead.

---

## Geospatial Files (GDAL-backed)

The `apache/tika:3.3.1-full` container includes GDAL, enabling processing of:

- GeoTIFF (`.tif`, `.tiff`) — spatial reference, bounding box, band info
- KML / KMZ — place names, coordinates, description text
- Shapefiles (`.shp` as ZIP) — use `/rmeta` on the ZIP
- GeoJSON — text extraction via `/tika`

For GeoTIFF specifically, `/meta` yields the CRS, pixel dimensions, and band metadata.
Full text is sparse but `/tika` will surface any embedded description fields.

---

## Obscure / Headerless Files

When `Content-Type` from `/meta` is `application/octet-stream` (Tika could not identify):

1. Use `/detect` endpoint — this invokes Google Magika (AI file type detection in 3.x)
2. Re-examine: is the file extension misleading? Try stripping it and resubmitting
3. If Magika still returns `application/octet-stream`, the file may be encrypted,
   custom-serialized, or genuinely unknown — surface this to the user

---

## Error Signals and Fallback Strategies

| Situation | Suggested Action |
|---|---|
| 422 on well-known MIME | File may be password-protected; report to user |
| OCR output is garbled | Try setting `X-Tika-OCRLanguage` to the correct language |
| `/rmeta` returns 1 item only | File is not compound; switch to `/tika` for cleaner output |
| Very large archive (>500 child objects) | Use `X-Tika-Skip-Embedded: true` + `/meta` first to assess |
| VBA macros present | Flag for security review; never execute extracted macro code |
| Tesseract exception in metadata | Check if the scanned PDF has a usable text layer; try `ocr_only` strategy |
