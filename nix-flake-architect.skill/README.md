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

```
nix-flake-architect.skill/
├── SKILL.md                          # Orchestration file — agent entry point
├── references/
│   ├── flake-schema.md               # Canonical input/output schema (RFC + manual)
│   ├── flake-patterns.md             # flake-parts, flake-utils, modules, overlays, migration
│   ├── purity-and-hermetics.md       # Hermetic evaluation rules, IFD, secrets
│   ├── cli-workflows.md              # Full nix CLI command reference
│   └── nixos-tools-guide.md            # When and how to query each nixos-tools resource
└── templates/
    ├── flake-parts-minimal.nix       # devShell + package (flake-parts)
    ├── flake-parts-nixos.nix         # Full NixOS + home-manager (flake-parts)
    ├── flake-utils-minimal.nix       # Legacy flake-utils (for reading existing flakes)
    └── home-config-template.nix      # Standalone home-manager configuration
```

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

  `nixos-tools` provides: nixpkgs package search, NixOS option lookup, Home Manager options,
  nix-darwin options, Nix function signatures (Noogle), FlakeHub flake registry, binary
  cache status, NixOS wiki, nix.dev tutorials, local flake input introspection, and Nixvim
  options.

## Installation

### opencode

Copy the skill directory into your project's skill store:

```bash
cp -r nix-flake-architect.skill /path/to/project/.opencode/skills/
```

Or install globally:

```bash
cp -r nix-flake-architect.skill ~/.config/opencode/skills/
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

The orchestration flow in `SKILL.md` is structured as a decision tree that a small model
can follow without needing prior Nix knowledge:

1. Query MCP for facts
2. Classify the output type
3. Select a framework
4. Load the matching template
5. Populate from MCP query results
6. Run the validation checklist

This keeps cognitive load minimal and reduces the surface area for hallucination.

## Sources

| Document | Primary Sources |
|---|---|
| `flake-schema.md` | [Nix Reference Manual — Flakes](https://nixos.org/manual/nix/stable/command-ref/new-cli/nix3-flake.html) |
| `flake-patterns.md` | [flake.parts](https://flake.parts), [numtide/flake-utils](https://github.com/numtide/flake-utils), [NixOS Wiki](https://wiki.nixos.org/wiki/Flakes), [Zero to Nix](https://zero-to-nix.com) |
| `purity-and-hermetics.md` | [nix.dev/concepts/flakes](https://nix.dev/concepts/flakes), Nix Reference Manual |
| `cli-workflows.md` | [Nix Reference Manual](https://nixos.org/manual/nix/stable), [Zero to Nix](https://zero-to-nix.com) |
| `nixos-tools-guide.md` | nixos-tools server capability documentation |

## Contributing

Reference documents should track upstream source changes. If a section is stale relative
to the canonical sources listed above, open a PR with the corrected content and a note
citing the upstream change.

Templates follow the principle of least surprise: they are conservative, well-commented,
and do not include patterns not covered by the reference documents.

## License

MIT
