---
name: nix-flake-architect
description: "Designs, scaffolds, debugs, and validates Nix flakes, flake-parts modules, NixOS and home-manager configurations, and nixpkgs overlays. Use when a request mentions flake.nix, flake.lock, nix build, nix develop, nix run, nix flake check, devShells, nixosConfigurations, nixosModules, home-manager, overlays.default, flake-parts, perSystem, or import-tree; when migrating shell.nix or default.nix to a flake; when pinning nixpkgs or wiring inputs.follows; or when a flake evaluates without error but produces empty or missing outputs. Covers flake-parts perSystem merge semantics and its silent-empty-output failure mode, overlays-only library flakes, and evaluation purity. For devenv 2.x development environments use devenv2-environment-generator instead; for migrating a whole NixOS repository to the dendritic pattern use nixos-den-architect."
license: MIT
compatibility: "Nix 2.18 or newer with flakes enabled. Optionally uses the nixos-tools MCP server for live nixpkgs package and NixOS, home-manager, nix-darwin, and Nixvim option lookups; without it, package attribute paths and option names cannot be verified at write time and must be flagged as unverified."
metadata:
  author: nix-flake-architect
  version: "2.0.0"
  flake-parts-target: "flake-parts 427bf4bd, verified 2026-08"
  nix-target: "2.34"
---

# Nix Flake Architect

## Skill Routing

| The request is really about | Use |
|---|---|
| A per-project dev environment driven by the `devenv` CLI — `devenv.nix`, `devenv.yaml`, `devenv up`, services, processes, tasks | `devenv2-environment-generator` |
| Migrating an entire NixOS repository to the dendritic pattern — `den`, aspect modules, one file per concern | `nixos-den-architect` |
| Everything else Nix: `flake.nix` itself, flake-parts modules, packages, overlays, NixOS and home-manager configurations | this skill |

Boundaries worth stating to the user rather than guessing at: authoring and distributing
an overlay is this skill, while consuming one inside a devenv environment is
`devenv2-environment-generator`; devenv `outputs` are not flake `packages` and never
appear under `nix flake show`; a devenv project consumed through the Nix flakes
integration cannot use SecretSpec, so surface that conflict before generating anything;
and a dendritic repository is still a flake-parts flake, so
`references/flake-parts-semantics.md` and `references/troubleshooting.md` apply unchanged.

---

## Phase 0: Verify Before Writing

Nix knowledge goes stale quickly, and a wrong attribute path or option name produces an
evaluation error rather than a graceful degradation — so verify names against the
nixos-tools MCP server rather than recalling them. It exposes two tools:
`mcp__nixos-tools__nix` takes an `action` plus `query` and narrows with `source` and
`type`; `mcp__nixos-tools__nix_versions` returns version history from NixHub.

| What you need | Call |
|---|---|
| Package attribute path, version | `nix {"action":"search","query":"<name>"}` then `{"action":"info","query":"<name>"}` |
| NixOS option name, type, default | `nix {"action":"search","query":"<opt>","type":"options"}` |
| Home Manager / nix-darwin / Nixvim option | `nix {"action":"search","query":"<opt>","source":"home-manager"}` (or `darwin`, `nixvim`) |
| Which nixpkgs commit shipped a version | `nix_versions {"package":"<name>","version":"<v>"}` |
| Flake metadata, wiki, nix.dev, Noogle | `nix {"action":"search","query":"<q>","source":"flakehub"}` (or `wiki`, `nix-dev`, `noogle`) |

Load `references/mcp-nixos-guide.md` for the full action matrix, browsing option trees,
binary-cache and store queries, and disambiguation strategy.

> If nixos-tools is unavailable, say so in the output and mark every package attribute
> path and option name as unverified rather than presenting it as confirmed.

---

## Phase 1: Triage — Mode and Output Type

Step 1A picks the distribution mode; it shapes the entire output structure.

| | Mode 1 — Canonical Flake | Mode 2 — Overlays-Only / Library |
|---|---|---|
| What it is | A buildable artifact users interact with | A nixpkgs extension consumed as an input |
| `nix build` / `nix run` | work | do not work, by design |
| Choose for | projects, tools, NixOS configs, devShells | org package registries, upstream patches, ecosystem package sets |
| Signals | anything not listed opposite | "distribute as an overlay", "inputs-only flake", "library flake"; consumers are other flakes; analogous to `oxalica/rust-overlay` |

**Default to Mode 1 when unsure** — an incorrect Mode 2 choice removes the CLI surface
users expect.

> For Mode 2: read `references/overlays-only-pattern.md` in full before proceeding, and
> present the CLI Impact Matrix (§3) so the trade-offs are explicit.

Step 1B picks the primary output type. Mode 1 covers `devShell`, `package`,
`nixosConfig`, `nixosModule`, `homeConfig`, an `overlay` published by a flake that also
builds packages, a `composite` of several of these, and `migration` of a legacy
`default.nix` / `shell.nix`. Mode 2 is `overlays-only` — a nixpkgs extension with an
inputs-only API. A flake that *consumes* an overlays-only input is Mode 1 with a Mode 2
dependency.

For migration read `references/flake-patterns.md § Migration`; for overlays-only read
`references/overlays-only-pattern.md`; for consuming one load
`templates/overlay-consumer-integration.nix`.

---

## Phase 2: Architecture Selection

**Default to flake-parts for all new flakes**, and for any existing flake-parts flake.
Use flake-utils only to maintain existing code built on `eachDefaultSystem`, and raw Nix
only for a trivial single-system one-off. Load `references/flake-patterns.md` for
framework guidance and boilerplate.

---

## flake-parts Contribution Rules

`perSystem` is not an attribute — it is a deferred module. Every definition of it is
collected into a list and evaluated together, once per system. Two consequences cause
most flake-parts failures:

- **A `perSystem` definition that evaluates to nothing is indistinguishable from one that
  was never written.** There is no error, no warning, and no empty-set diagnostic. A `mkIf`
  with a false condition, an `enable` option left at its `false` default, a module file
  missing from `imports`, and an `import-tree` path containing `/_` all produce the same
  outcome: a flake that evaluates cleanly and has no outputs. An opt-in module needs a
  companion `perSystem = { myFeature.enable = true; };` written in the same change.
  Verify contributions with `nix eval .#packages.<system> --apply builtins.attrNames`
  before reporting success.
- **`pkgs`, `system`, `inputs'`, and `self'` exist only inside `perSystem`;** `inputs`,
  `self`, `withSystem`, and `getSystem` exist only outside it. Build derivations inside
  `perSystem`. When a `flake.*` output needs a package, reach in with
  `withSystem "<system>" ({ pkgs, ... }: …)` rather than pulling `pkgs` outward. These
  errors are lazy — `builtins.attrNames` reports names without forcing values, so force
  the value to surface them.

Before writing a flake-parts module, read `references/flake-parts-semantics.md`. When
outputs are missing but nothing errored, read `references/troubleshooting.md`.

---

## Phase 3: System Architecture

Standard system strings: `x86_64-linux` (most servers and Linux desktops), `aarch64-linux`
(ARM servers, Raspberry Pi), `x86_64-darwin` (Intel Macs), `aarch64-darwin` (Apple Silicon).
With flake-parts, set `systems` and use `perSystem`; do not hardcode system strings in
outputs. With flake-utils, use `eachDefaultSystem` or `eachSystem`. With raw Nix, hardcode
only when single-system is intentional and documented. Under `import-tree`, `systems` must
live in a module file — see `references/import-tree-and-dendritic.md`.

---

## Phase 4: Inputs — Composition and Pinning

**Purity rule (non-negotiable):** flake evaluation is hermetic — no environment variables,
no `~/.config`, no network access during evaluation, every dependency declared as an
input. Read `references/purity-and-hermetics.md` before adding one.

```nix
inputs = {
  nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  home-manager = {
    url = "github:nix-community/home-manager";
    inputs.nixpkgs.follows = "nixpkgs";
  };
  flake-parts.url = "github:hercules-ci/flake-parts";
};
```

Set `inputs.<name>.follows = "nixpkgs"` for every input that transitively depends on
nixpkgs; skipping it causes duplicate nixpkgs evaluations and bloated closures. Verify
third-party input URLs with `nix {"action":"search","query":"<name>","source":"flakehub"}`.

---

## Phase 5: Build the Flake

| Use case | Template |
|---|---|
| flake-parts devShell or package | `templates/flake-parts-minimal.nix` |
| flake-parts + NixOS config | `templates/flake-parts-nixos.nix` |
| flake-utils devShell or package | `templates/flake-utils-minimal.nix` |
| Home Manager standalone | `templates/home-config-template.nix` |
| Overlays-only library flake (Mode 2) | `templates/overlays-only-flake.nix` |
| Consuming an overlays-only flake (Mode 1+2) | `templates/overlay-consumer-integration.nix` |

Populate templates with attribute paths and option names verified in Phase 0, and with the
output shapes in `references/flake-schema.md`. For Mode 2, also confirm the new attribute
names do not collide with existing top-level nixpkgs attrs.

---

## Phase 6: Validation Checklist

Run before delivering. Mode 2 adds a second checklist in
`references/overlays-only-pattern.md § Validation`.

- [ ] Every `perSystem` contribution verified present: `nix eval .#packages.<system> --apply builtins.attrNames`
- [ ] No `perSystem` module gated on an `enable` option that nothing sets to `true`
- [ ] No `pkgs`, `system`, `inputs'`, or `self'` referenced outside a `perSystem` function
- [ ] `src = ./<dir>` consumers address files at the root of `$src`, not under `<dir>/`
- [ ] All `inputs.<name>.follows` set for inputs that consume nixpkgs
- [ ] No hardcoded system strings when using flake-parts or flake-utils
- [ ] No evaluation-time impurities (env vars, `builtins.readFile` outside src, avoidable IFD)
- [ ] `nixpkgs.config.allowUnfree` declared explicitly if needed, never implicit
- [ ] `nixosConfigurations.<name>.system` not set (deprecated); use `pkgs.system` from module args
- [ ] `packages.<system>.default` points to the primary deliverable
- [ ] `devShells.<system>.default` present for `nix develop`
- [ ] New files staged with `git add` — untracked files are invisible to nix, silently
- [ ] All package versions and option names verified via nixos-tools, not assumed

---

## Phase 7: CLI Guidance

Provide the exact commands to test the flake — `nix flake check`, `nix develop`,
`nix build`, `nix run`, `nix flake show`, `nix flake update`. Load
`references/cli-workflows.md` for the full command map; Mode 2's narrower surface is
documented in `references/overlays-only-pattern.md §3`.

---

## Reference Routing

Load reference files when the routing signal appears — at design time for the first group,
at failure time for the symptom group. Never load all of them: each is a standalone
document and only the routed ones are relevant.

| Request characteristic or symptom | Load |
|---|---|
| Any flake-parts flake, before writing the first `perSystem` or module file | `references/flake-parts-semantics.md` |
| Any package name, option name, or third-party flake URL about to be written | `references/mcp-nixos-guide.md` |
| A flake evaluates and exits 0 but `nix flake show` lists no packages or devShells | `references/troubleshooting.md` |
| `attribute 'pkgs' missing`; `is not a 'perSystem' module argument`; `The option 'packages' does not exist`; `does not provide attribute` | `references/troubleshooting.md` |
| A build fails on a path under `src`, or `src` contents are not where expected | `references/troubleshooting.md` |
| Infinite recursion; `nix flake check` passes but `nix build` fails; a new file has no effect | `references/troubleshooting.md` |
| `import-tree`, a dendritic `modules/` tree, `_`-prefixed paths, where `systems` belongs | `references/import-tree-and-dendritic.md` |
| Choosing a framework, authoring a NixOS module, migrating `shell.nix` / `default.nix` | `references/flake-patterns.md` |
| Output attribute names, `follows`, flake URL syntax, `nixConfig`, `flake.lock` | `references/flake-schema.md` |
| Adding an input; env vars, IFD, secrets, `allowUnfree`, CI constraints | `references/purity-and-hermetics.md` |
| Handing the user commands to build, enter, check, or roll back | `references/cli-workflows.md` |
| Distributing packages as an overlay consumed by other flakes (Mode 2) | `references/overlays-only-pattern.md` |

Templates are routed by output type in [Phase 5](#phase-5-build-the-flake).

---

## Output Format

Deliver a complete, commented `flake.nix`; any supporting `modules/`, `homes/`, or
`pkgs/` stubs; the exact CLI commands to build, enter, and check it; and a note on which
values were confirmed via nixos-tools versus inferred. Deliver complete expressions —
do not truncate with `# ... rest here`.
