# Work-package partition

The standing map from work package to owned files. Phase 3 of the bump computes
scope by intersecting the affected-file set with this table — it never improvises
a package boundary. Packages are **file-disjoint**, which is what makes parallel
worktree writes conflict-free and Phase 6 merges trivial.

Paths are relative to the skill root (the directory containing `SKILL.md`).

## Package table

| Package | Theme | Owned files |
| --- | --- | --- |
| `core` | Entry point, routing, version of record | `SKILL.md`, `README.md` |
| `stacks` | What you build with | `references/languages.md`, `references/services.md` |
| `runtime` | What runs and when | `references/processes.md`, `references/tasks.md`, `references/scripts-and-files.md` |
| `composition` | How configs and secrets compose | `references/yaml.md`, `references/composing.md`, `references/secrets.md`, `references/git-hooks.md` |
| `new-surface` | Newer devenv surfaces | `references/profiles.md`, `references/cli.md`, `references/ai-integration.md` |
| `build-misc` | Build outputs and long-tail integrations | `references/outputs-containers-testing.md`, `references/misc-integrations.md` |
| `examples` | Runnable projects | `examples/**` |
| `process` | The bump machinery itself | `.claude/**` |

## Ownership rules

1. **Exactly one owner.** Every file in the skill tree belongs to exactly one
   package. A file with two owners is a partition bug — fix the table before
   spawning writers, not during.
2. **Writers touch only their package's files.** Cross-references may *name* any
   file in the tree (filenames are frozen by the Phase 3 contract), but a writer
   editing outside its set is an automatic verifier FAIL.
3. **`core` owns the version of record.** `metadata.devenv-target` in `SKILL.md`
   is bumped by the `core` package and by nobody else. If `core` is not otherwise
   activated, Phase 6 still activates it for the version bump alone.
4. **`core` owns the routing table.** Any package that adds, removes, or renames a
   reference file must report it so `core` updates the load-on-demand list in
   `SKILL.md`. Phase 7 fails the merge if a routing target does not exist.
5. **`process` is self-hosting.** The bump agents, this partition, the style
   guide, and the schemas live under `.claude/` and are owned by `process`.
   Bumping them is a normal work package, not a special case.

## Rule for new reference files

When the delta demands a surface no existing file covers:

1. Assign it to the **closest-scoped existing package** — the one whose theme it
   would have belonged to had it existed. Prefer growing a package over inventing
   one; a new package is justified only when the new surface is disjoint from
   every existing theme *and* large enough that a single writer could not hold
   both in a line budget.
2. Add the file to the table above **as part of the same bump**, in the same
   commit as the file itself. An untracked file is invisible to the next bump's
   Phase 3 scoping, which is how surfaces silently rot.
3. Record the new filename in the Phase 3 frozen contract before any writer
   starts, so sibling packages can link to it by its final name.
4. Tell `core` to add it to the routing list in `SKILL.md`.

Deletions follow the mirror path: the owning package removes the file, `core`
removes the routing entry, and the row is struck from this table in the same bump.

## Placement heuristics for new surfaces

| If the new surface is about... | It belongs to |
| --- | --- |
| a language toolchain or a service daemon | `stacks` |
| something that executes (process, task, script, generated file) | `runtime` |
| `devenv.yaml`, imports, inputs, secrets, hooks | `composition` |
| profiles, the CLI, LSP/MCP/AI-agent integration | `new-surface` |
| build outputs, containers, testing, one-off tool integrations | `build-misc` |
| a runnable demonstration of any of the above | `examples` |
| an agent, schema, or procedure used to maintain the skill | `process` |
