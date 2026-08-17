---
name: bump-devenv
description: "Update the devenv environment-generator skill to a newer devenv release. Use when asked to 'bump devenv', 'update the skill to the latest devenv', 'devenv X.Y released — update the skill', 'check if devenv has a new version', or to audit the skill against current devenv docs. Runs a scout/map → audit → scope → parallel write → verify → merge pipeline with fixed report schemas and a written merge gate."
license: MIT
metadata:
  author: devenv2-environment-generator
  pipeline-version: "1"
allowed-tools: Read, Grep, Glob, Bash, Agent, Edit, Write
---

# Bump devenv

Orchestration procedure for the lead session updating the devenv
environment-generator skill to a newer devenv release. You coordinate; five
specialized agents do the work. Follow the phases in order — the order is the
mechanism, not a suggestion.

Supporting files:

- [Work-package partition](references/partition.md) — package → owned files
- [Style guide](references/style-guide.md) — standing conventions for the skill
- [Report schemas](references/report-schemas.md) — the fixed agent report shapes

## Determinism anchors

Five things make this pipeline reproducible rather than a fresh improvisation
each time. Preserve all five; when a phase feels awkward, fix the anchor rather
than routing around it.

1. **`metadata.devenv-target` in `SKILL.md`** — the single record of what the
   skill targets. Every run starts and ends here.
2. **Fixed report schemas** — agents return parseable shapes, so routing is
   computed from their output, not inferred from prose.
3. **`references/partition.md`** — scope is computed by intersecting affected
   files with a standing table, never improvised.
4. **Written gate criteria** — the verifier's tiers are enumerated in advance, so
   a package passes on the same evidence every time.
5. **Encoded phase order** — scout before audit before scope before write before
   verify before merge. No phase runs on a guess about a later one.

## Phase 0 — Preflight

Read `metadata.devenv-target` from the skill root's `SKILL.md`. That is CURRENT.

Probe local tooling and set the verification-tier ceiling:

```bash
command -v devenv nix jq
```

| Available | Ceiling |
| --- | --- |
| `devenv` | T4 full — live example evaluation |
| `nix` only | T4 partial — `nix-instantiate --parse` catches syntax only |
| neither | T4 skipped — record it, confidence reduced |

Record the ceiling and pass it to every verifier you spawn. A skipped tier is
reported as reduced confidence, never as a silent pass — the whole point of the
gate is that the lead knows what was and was not checked.

## Phase 1 — Scout ∥ Map

Spawn both in parallel, in one message:

- `devenv-release-scout` — reads CURRENT from `SKILL.md`, establishes LATEST from
  `https://devenv.sh/blog/` and the GitHub releases API, emits the per-release
  delta (Schema A).
- `devenv-docs-mapper` — sitemap, options reference, yaml options,
  `devenv.schema.json`, `cli.rs`, and local `devenv --help`; emits the inventory
  and the "trust X over Y" rulings (Schema B).

**If the scout returns `STATUS: NO-OP`, stop.** Report that the skill is already
current, name the version, and end the run. Do not audit, do not "freshen while
we're here" — a no-op bump that edits files is how drift gets introduced.

## Phase 2 — Audit

Spawn `devenv-skill-auditor` with both reports as input. It sweeps every skill
file and returns the defect list (Schema C): category, `file:line`, claim vs.
truth, source URL, owning package, severity.

Resolve any `PACKAGE: UNASSIGNED` defect now, before scoping.

## Phase 3 — Scope

Compute the active package set. Do not choose it.

1. Union the scout's `SURFACE-TOUCHED` with the files named in the auditor's
   defect list → the affected-file set.
2. Intersect that with the table in [references/partition.md](references/partition.md).
3. Activate **only** the packages that own an affected file. A package with no
   affected files does not run, however tempting it looks.
4. `core` is additionally activated whenever the bump proceeds at all, because it
   owns `metadata.devenv-target`.

Then freeze a contract for this bump and give every writer the same copy:

- the complete file list of the tree after the bump,
- [references/style-guide.md](references/style-guide.md), unchanged,
- any **new filenames** the delta demands — assign each to the closest-scoped
  package per the partition's placement heuristics, and add the row to
  `references/partition.md` as part of this bump,
- the per-package defect lists and line budgets.

Freezing filenames before writing is what lets parallel packages link to files
that do not exist yet.

## Phase 4 — Write

Spawn one `devenv-reference-writer` per active package, **in parallel, each with
`isolation: worktree`**. Each spawn prompt carries that package's spec: assigned
files, the frozen contract, the scout and mapper reports, its routed defects, and
its line budgets.

Packages are file-disjoint, so parallel writes cannot collide. Writers do not
commit; they leave changes uncommitted in their worktrees and return Schema D.

## Phase 5 — Verify

Spawn one `devenv-skill-verifier` per package worktree. Tiers:

| Tier | Checks |
| --- | --- |
| T1 | static lint — no `<n>`, links resolve, line budgets, snake_case yaml, examples ship required files |
| T2 | every yaml key against `devenv.schema.json` |
| T3 | every option path, flag, env var, URL, version claim cross-checked upstream |
| T4 | live example evaluation, when the package changed `examples/` |

On `VERDICT: FAIL`, send the findings back to the **same writer** — same worktree,
same context — and re-verify. Maximum three rounds; if a package still fails,
escalate to the user with the outstanding findings rather than merging or
silently dropping the package.

## Phase 6 — Merge

Merge each passing worktree into the working branch. Packages are file-disjoint,
so merges are conflict-free by construction; a conflict means the partition was
violated — stop and fix the partition rather than resolving the conflict by hand.

Bump `metadata.devenv-target` to LATEST. This is owned by `core` and happens
exactly once, here.

## Phase 7 — Final gate

Run `devenv-skill-verifier` once over the **merged tree** (`PACKAGE: MERGED-TREE`):

- cross-package consistency — every routing target in `SKILL.md` exists, no orphan
  links, no two references contradicting each other,
- `metadata.devenv-target` equals the scout's LATEST,
- the full example evaluation suite at the Phase 0 ceiling.

Only after this passes: commit on a branch (never on the default branch) and offer
to open a PR. Summarize for the user the version moved from and to, the packages
that ran, the defects closed, and anything a writer flagged as unconfirmed.
