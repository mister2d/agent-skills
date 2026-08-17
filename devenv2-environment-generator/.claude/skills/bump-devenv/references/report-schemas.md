# Fixed report schemas

Every agent in the bump pipeline emits one of the schemas below, verbatim, as the
last thing it returns. Fixed schemas are the determinism mechanism: the lead
session parses these shapes, not prose, so a re-run with the same inputs produces
the same routing decisions. An agent that returns free-form prose instead of its
schema is treated as a failed run and re-spawned.

Rules that apply to every schema:

- Emit the section headers exactly as written, in the order written, even when a
  section is empty (use `(none)`).
- Every externally-verifiable claim carries a source URL or a local command.
- Never guess. "Unverified" is a legal value; a fabricated option name is not.

---

## Schema A — scout delta (devenv-release-scout)

If `CURRENT == LATEST`, emit only:

```
STATUS: NO-OP
CURRENT: <version from metadata.devenv-target>
LATEST: <version>
SOURCE: <url that established LATEST>
```

Otherwise:

```
STATUS: DELTA
CURRENT: <version>
LATEST: <version>
SOURCES: <urls consulted for the version list>

## <version> — <YYYY-MM-DD>
RELEASE-URL: <github release or blog post url>

### Breaking changes
- <change> — <impact on skill guidance> [<url>]

### New features
- <feature> — <option path / CLI flag / yaml key, if any> [<url>]

### Deprecations
- <what is deprecated> — <replacement> [<url>]

### Changed defaults
- <option or flag> — <old default> -> <new default> [<url>]

### New or changed doc URLs
- <url> — new | changed | removed

(repeat the block for every release in (CURRENT, LATEST], oldest first)

## Rollup
BREAKING-TOTAL: <count>
SURFACE-TOUCHED: <comma-separated skill topics: languages, services, processes,
tasks, yaml, cli, profiles, secrets, git-hooks, examples, ...>
```

Every bullet ends with a bracketed URL. Bullets without a URL are dropped.

---

## Schema B — docs inventory (devenv-docs-mapper)

```
STATUS: INVENTORY
LOCAL-DEVENV: <version, or "not installed">
SITEMAP: <url> — <count> urls

## Page inventory
<section name>: <path> | <path> | ...
(repeat per section)

## Option namespaces
| Namespace | Doc URL | Notes |
| --- | --- | --- |

## CLI tree
SOURCE: local `devenv --help` | cli.rs url | both
<command> [<subcommand> ...] — <flags>
(one line per command; subcommands indented)

### Global flags
<group>: <flags>

## devenv.yaml keys
SOURCE: <yaml-options url and/or devenv.schema.json>
<key> — <type> — <default> — snake_case confirmed: yes|no

## Environment variables
SET-BY-DEVENV: <var> — <meaning>
READ-BY-DEVENV: <var> — <meaning>
EXTERNAL-HONORED: <var> — <meaning>

## Counts
LANGUAGES: <count> (source: <url>)
SERVICES: <count> (source: <url>)

## Doc inconsistencies
- CONFLICT: <short name>
  A: <claim> [<url>]
  B: <claim> [<url>]
  RULING: trust A | trust B | trust neither, because <reason>
```

Every CONFLICT needs a RULING. "Unresolved" is acceptable only with an explicit
note telling writers to omit the topic entirely.

---

## Schema C — defect list (devenv-skill-auditor)

```
STATUS: AUDIT
FILES-SWEPT: <count>
DEFECTS: <count>

## Defects
### D<nn> — <category>
CATEGORY: Bug | Stale | Gap | Self-inconsistency | Convention violation
LOCATION: <relative/path.md>:<line>   (use :0 for whole-file or missing-file gaps)
CLAIM: <what the skill currently says, quoted or summarized>
TRUTH: <what is actually correct>
SOURCE: <url or local command that establishes TRUTH>
PACKAGE: <work package name from partition.md>
SEVERITY: blocker | major | minor

## Package rollup
<package>: D<nn>, D<nn>, ...
```

Category definitions:

- **Bug** — the skill states something that is false today and was false when written.
- **Stale** — true for an older devenv, false for the target version.
- **Gap** — a surface the delta or inventory says exists that the skill never mentions.
- **Self-inconsistency** — two skill files (or two sections of one file) disagree.
- **Convention violation** — breaks `style-guide.md` (camelCase yaml, `<n>`
  placeholder, line budget, broken relative link, ...).

Every defect carries a PACKAGE. If no package owns the file, the auditor reports
`PACKAGE: UNASSIGNED` and the lead resolves it in Phase 3 before any writing.

---

## Schema D — writer self-report (devenv-reference-writer)

```
WORKTREE: <absolute path from `pwd`>

CHANGED:
- <path> (<count> lines)
(must equal the assigned file set — no more, no fewer)

CLAIMS:
| Claim | Kind | Verified against |
| --- | --- | --- |
| <option path / CLI flag / yaml key / env var / URL / version> | option, flag, yaml, env, url, or version | <url or local command> |

FLAGS:
- <thing that could not be confirmed> — omitted from the file — <what would settle it>
- <open question for the lead>
(or `(none)`)

DEFECTS-CLOSED: D<nn>, D<nn>, ...
DEFECTS-DEFERRED: D<nn> — <reason>
```

The writer never runs `git commit`. Changes stay uncommitted in the worktree.

---

## Schema E — verifier verdict (devenv-skill-verifier)

```
VERDICT: PASS | FAIL
PACKAGE: <work package name>
WORKTREE: <absolute path verified>
TIERS-RUN: T1 <pass|fail> | T2 <pass|fail|skipped> | T3 <pass|fail> | T4 <pass|fail|skipped: reason>

## Findings
### F<nn> — FAIL | WARN
LOCATION: <path>:<line>
CLAIM: <the extracted claim as written in the diff>
SOURCE-CHECKED: <url, `curl ... | jq ...`, or local command actually run>
RESULT: <what the source said>
VERDICT: fail | warn | pass-with-note
FIX: <the minimal correction the writer should make>

## Coverage
OPTIONS-CHECKED: <count>   YAML-KEYS-CHECKED: <count>   FLAGS-CHECKED: <count>
ENV-VARS-CHECKED: <count>  URLS-CHECKED: <count>        VERSION-CLAIMS-CHECKED: <count>

## Confidence
full | reduced: T4 skipped because devenv is not installed | reduced: <reason>
```

Any finding with `VERDICT: fail` forces `VERDICT: FAIL` at the top and blocks the
merge. `WARN` findings never block but are reported to the lead. A verifier that
cannot reach a source records the claim as a WARN with
`SOURCE-CHECKED: unreachable` — it never silently passes it.
