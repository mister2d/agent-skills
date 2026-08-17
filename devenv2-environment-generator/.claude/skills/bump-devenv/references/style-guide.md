# Style guide

Standing conventions for every file in the devenv environment-generator skill.
Binding on every work-package writer; deviations are verifier failures, not taste
disagreements. The lead re-freezes this file into each bump's contract unchanged.

## Hard rules

1. **Verify before you write.** Every devenv option path, yaml key, CLI flag, and
   environment variable you state must be confirmed against one of:
   - the local CLI — `devenv --help`, `devenv <cmd> --help` (strongest source when
     the installed version matches the target),
   - `https://devenv.sh/reference/options/`,
   - `https://devenv.sh/devenv.schema.json`,
   - `https://devenv.sh/reference/yaml-options/`.

   Never write an option name from memory. **If you cannot confirm something,
   omit it and flag it in your final report.** A gap is recoverable; a fabricated
   option name teaches users something false.

2. **snake_case only in devenv.yaml.** Every yaml snippet uses snake_case keys
   (`strict_ports`, `nixpkgs.allow_unfree`, `clean.enabled`,
   `android_sdk.accept_license`, ...). camelCase anywhere in a yaml snippet is an
   automatic FAIL. This applies only to yaml — Nix option paths keep their own
   upstream casing (`enterShell`, `execIfModified`, `startupCommand`).

3. **Placeholders are `<name>`, `<lang>`, `<port-name>`, `<namespace>`.** Use the
   most specific one that fits. The token `<n>` must not appear in skill content
   — it is the signature of a previous mangling bug and is linted for. Use
   `<count>` for numeric placeholders so the lint stays unambiguous. The lint
   exempts prose that is *about* the forbidden token (this rule, and the agent
   definitions that restate it).

4. **`restart` values are `"never" | "always" | "on_failure"`** — underscores,
   never hyphens. The same goes for any other underscore-valued enum you quote:
   copy it from the options reference, do not re-spell it.

5. **One authoritative version string.** `SKILL.md` frontmatter
   `metadata.devenv-target` is the only place a target version is asserted. In
   prose prefer "devenv 2.x"; name a specific version only when describing when a
   behavior changed (e.g. "since 2.2"). Never restate the target version as a
   fact in a reference file — it will drift.

6. **`devenv.nix` is mandatory** in every generated or example project. Since 2.2,
   auto-activation keys on `devenv.nix`, not `devenv.yaml`. Never state the
   inverse, and never show a project whose only config file is `devenv.yaml`.

7. **Do not encode known upstream doc traps.** When two upstream pages disagree,
   the mapper's ruling wins; state which source you confirmed against. Re-check
   long-standing traps at write time rather than trusting a previous bump's note.

## Example projects

- Never commit `devenv.lock` or `.devenv/` into an example.
- Every example ships a `.gitignore` containing `.devenv/` and `.direnv/`.
- Every example shipping `secretspec.toml` sets `secretspec.enable: true` in its
  `devenv.yaml`.
- Every example using `git-hooks.hooks` declares the `git-hooks` input
  (`github:cachix/git-hooks.nix`) in its `devenv.yaml`. The converse also holds:
  do not declare an input the example never uses.
- No hardcoded port literals where a `config.processes.<name>.ports.<port-name>.value`
  or service-port wiring exists. Reference the config value at eval time; never
  shell out to `devenv eval` from `enterShell` to read your own config.
- Every environment variable an example interpolates must be declared somewhere in
  that example.
- Recommended nixpkgs input: `github:cachix/devenv-nixpkgs/rolling`.

## Document structure

- One H1 title per file. H2 for sections. H3 sparingly.
- Lead each file with 1–3 sentences of scope, then content. No table of contents.
- Code fences are tagged: `nix`, `yaml`, `bash`, `toml`.
- Option lists render as tables (`Option | Type | Default | Description`) or as
  annotated nix blocks — match the pattern already used in sibling references.
- Comments in nix snippets state constraints and behavior, not narration.
  Good: `# null for unlimited`. Bad: `# set the restart limit`.
- End a section that summarizes an upstream doc page with that page's URL on its
  own line.

## Links

- Reference other skill files by relative path: `references/tasks.md` from
  `SKILL.md`; `tasks.md` from a sibling reference.
- Link to specific upstream pages, never to a bare index, when citing a claim.
- Every relative link must resolve in the merged tree. Linking to a file another
  package is creating in the same bump is fine — the filename is frozen by the
  Phase 3 contract — but the link must be to the frozen name, exactly.

## Line budgets

These apply to the generator skill's own content files. Files under `.claude/`
(the bump machinery) are sized to their job and carry no budget.

| File | Budget |
| --- | --- |
| `SKILL.md` | ≤ 230 lines |
| each `references/*.md` | 130–300 lines |

A reference under 130 lines is a signal the topic was under-served; over 300 is a
signal it should be split (and the split file assigned per `partition.md`).

## Report requirement

Every writer ends its run with the writer self-report from `report-schemas.md`:
`WORKTREE`, `CHANGED`, `CLAIMS`, `FLAGS`. The `CLAIMS` table lists every
externally-verifiable claim written and the source it was confirmed against —
this is what the verifier audits against the diff.

Writers do **not** run `git commit`. Changes stay uncommitted in the worktree for
the verifier and the lead's merge step.
