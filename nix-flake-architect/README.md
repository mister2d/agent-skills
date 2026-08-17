# nix-flake-architect

An AI agent skill for designing, scaffolding, and validating Nix Flakes and NixOS
configurations. Targets agents from small parameter models to large, filling the knowledge
gap with structured reference material and live data via the `nixos-tools` MCP server.

## Overview

Nix Flakes have sharp edges. Option names, package attribute paths, and framework idioms
change across nixpkgs channels, and most LLMs have stale or incomplete training data on
the NixOS ecosystem. This skill addresses that by:

- Providing canonical, source-grounded reference documents for flake schema, framework
  selection, purity rules, and CLI workflows
- Issuing structured queries to the `nixos-tools` MCP server for real-time package names,
  option types, binary cache status, and flake input URLs before writing any expression
- Supplying ready-to-populate templates for common flake patterns to prevent hallucinated
  attribute paths or invalid option structures

## Repository Structure

`SKILL.md` deliberately stays small. Everything deep — flake-parts merge semantics,
symptom-driven diagnosis, the overlay distribution pattern, the CLI surface — lives in
`references/` and is loaded only when the request or the failure routes to it.

```
nix-flake-architect/
├── SKILL.md                          # Orchestration file — agent entry point
├── references/
│   ├── flake-parts-semantics.md      # perSystem merge semantics, module arg scope, debug
│   ├── troubleshooting.md            # Symptom → diagnosis → fix, with captured error text
│   ├── import-tree-and-dendritic.md  # import-tree mechanics, where `systems` must live
│   ├── flake-schema.md               # Canonical input/output schema (RFC + manual)
│   ├── flake-patterns.md             # flake-parts, flake-utils, modules, overlays, migration
│   ├── overlays-only-pattern.md      # Mode 2: library flakes, fixed-point law, CLI impact
│   ├── purity-and-hermetics.md       # Hermetic evaluation rules, IFD, secrets
│   ├── cli-workflows.md              # Full nix CLI command reference
│   └── mcp-nixos-guide.md            # nixos-tools action/source matrix and query patterns
└── templates/
    ├── flake-parts-minimal.nix       # devShell + package (flake-parts)
    ├── flake-parts-nixos.nix         # Full NixOS + home-manager (flake-parts)
    ├── flake-utils-minimal.nix       # Legacy flake-utils (for reading existing flakes)
    ├── home-config-template.nix      # Standalone home-manager configuration
    ├── overlays-only-flake.nix       # Mode 2 library flake
    └── overlay-consumer-integration.nix  # Consuming an overlays-only input
```

## Related Skills

- `devenv2-environment-generator` — per-project dev environments driven by the `devenv`
  CLI. This skill authors and distributes overlays; devenv2 consumes them.
- `nixos-den-architect` — migrating a whole NixOS repository to the dendritic pattern.

## Requirements

### Required
- An agent runtime that supports the skill package format (e.g., `opencode`)
- The agent must be able to read files from `references/` and `templates/` on demand

### Optional but Strongly Recommended
- **`nixos-tools` MCP server** connected to the agent session

  The skill is designed to assume the LLM has little to no NixOS knowledge. Without
  `nixos-tools`, the agent cannot verify package attribute paths or option names in real
  time and must rely solely on the static reference documents, which may not reflect the
  current nixpkgs channel.

  `nixos-tools` exposes two tools — `nix` (actions: search, info, browse, stats, channels,
  flake-inputs, cache, store) and `nix_versions`. Between them they cover nixpkgs packages,
  NixOS / Home Manager / nix-darwin / Nixvim options, Noogle function signatures, FlakeHub,
  binary cache status, the NixOS wiki, nix.dev, and local flake input introspection.

## Installation

### opencode

Copy the skill directory into your project's skill store:

```bash
cp -r nix-flake-architect /path/to/project/.opencode/skills/
```

Or install globally:

```bash
cp -r nix-flake-architect ~/.config/opencode/skills/
```

The skill is activated when the agent detects flake-related intent in the user's request
(see the `description` field in `SKILL.md` for the full trigger vocabulary).

### Other Agent Runtimes

Place `SKILL.md` where the runtime expects its skill orchestration file. Ensure the
`references/` and `templates/` directories are co-located so relative path resolution works.

## Design Decisions

### MCP-First Architecture

The SKILL.md instructs the agent to query `nixos-tools` before writing any Nix expression.
This is intentional: Nix package attribute paths and option names are not stable across
time or across channels, and a guessed path that evaluates silently to nothing is harder
to debug than an explicit query failure.

The reference documents serve as a fallback structural framework (schema, patterns, purity
rules) that does not change frequently, while `nixos-tools` provides the live data layer.

### flake-parts as Default

All templates and guidance default to `flake-parts`. This aligns with the direction of the
community (Hercules CI, enterprise adopters) and with the source material provided at
[flake.parts](https://flake.parts). `flake-utils` patterns are documented for reading legacy
flakes but are not the default generation target.

### Small-Model Compatibility

The orchestration flow in `SKILL.md` is structured as a phase sequence a small model can
follow without prior Nix knowledge: route to the right skill, verify facts against MCP
(Phase 0), triage mode and output type (Phase 1), select a framework (Phase 2), apply the
flake-parts contribution rules, settle systems and inputs (Phases 3–4), populate a
template (Phase 5), run the validation checklist (Phase 6), and hand over CLI commands
(Phase 7).

Two of those earn their place from observed failures rather than from theory. The
**flake-parts Contribution Rules** section sits in `SKILL.md` rather than a reference
because an agent that does not know a `perSystem` contribution can vanish silently will
never think to look the behavior up. The **Reference Routing** table is keyed on symptoms
as well as request characteristics, so a failure the agent is already looking at routes it
to `troubleshooting.md` without needing a diagnosis first.

## Sources

| Document | Primary Sources |
|---|---|
| `flake-parts-semantics.md` | [flake.parts](https://flake.parts) and the flake-parts source (`modules/perSystem.nix`, `modules/nixpkgs.nix`, `modules/debug.nix`, `modules/withSystem.nix`); nixpkgs `lib/modules.nix` |
| `troubleshooting.md` | Error text captured from live runs against flake-parts `427bf4bd` and nixpkgs `e5bdc4a4` |
| `import-tree-and-dendritic.md` | [vic/import-tree](https://github.com/vic/import-tree), verified against `4ebb10ae` |
| `flake-schema.md` | [Nix Reference Manual — Flakes](https://nixos.org/manual/nix/stable/command-ref/new-cli/nix3-flake.html) |
| `flake-patterns.md` | [flake.parts](https://flake.parts), [numtide/flake-utils](https://github.com/numtide/flake-utils), [NixOS Wiki](https://wiki.nixos.org/wiki/Flakes), [Zero to Nix](https://zero-to-nix.com) |
| `overlays-only-pattern.md` | Nix Reference Manual, nixpkgs overlay conventions |
| `purity-and-hermetics.md` | [nix.dev/concepts/flakes](https://nix.dev/concepts/flakes), Nix Reference Manual |
| `cli-workflows.md` | [Nix Reference Manual](https://nixos.org/manual/nix/stable), [Zero to Nix](https://zero-to-nix.com) |
| `mcp-nixos-guide.md` | The live `nixos-tools` MCP server tool schema |

Error strings in `troubleshooting.md` are pasted from real runs, never paraphrased — a
paraphrased error defeats the grep an agent actually performs. When updating that file,
reproduce the failure first.

## Contributing

Reference documents should track upstream source changes. If a section is stale relative
to the canonical sources listed above, open a PR with the corrected content and a note
citing the upstream change.

Templates follow the principle of least surprise: they are conservative, well-commented,
and do not include patterns not covered by the reference documents.

## License

MIT
