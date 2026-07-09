---
name: nix-flake-architect
description: >
  Expert skill for designing, scaffolding, and validating Nix Flakes and NixOS configurations.
  Use this skill whenever the user asks to create, debug, migrate, or explain a flake.nix,
  nixosConfiguration, devShell, overlay, NixOS module, home-manager configuration, or any
  Nix/NixOS build artifact. Triggers on: "write a flake", "create a devShell", "set up NixOS",
  "add a package to nix", "migrate to flakes", "debug my flake", "write a NixOS module",
  "configure home-manager", "pin nixpkgs", "overlays-only flake", "library distribution flake",
  "inputs-only flake", "distribute packages via overlay", "consume overlay as input",
  or any reference to flake.nix, flake.lock, nix develop, nix build, nix run,
  nixosConfigurations, flake-parts, overlays.default, or fixed-point overlay composition.
  Always use this skill even for simple flake questions — Nix has sharp edges and
  correct canonical patterns matter greatly.
compatibility:
  optional_mcp: nixos-tools
---

# Nix Flake Architect

## CRITICAL: Ground Every Response in Canonical Sources

You likely have limited or stale knowledge of Nix/NixOS internals. **This is not a failure — it
is expected.** The nixos-tools MCP server compensates for this. Follow the protocol below strictly.

---

## Phase 0: MCP-First Information Gathering

Before writing any Nix expression, execute the relevant queries against nixos-tools:

| What You Need | nixos-tools Resource to Query |
|---|---|
| Package name, version, attribute path | `nixpkgs_search` or `package_versions` |
| NixOS option name, type, default, example | `nixos_options_search` |
| Home Manager option | `home_manager_options_search` |
| nix-darwin option | `darwin_options_search` |
| Nix built-in function signature | `noogle_search` |
| NixOS wiki article | `nixos_wiki` |
| nix.dev tutorial content | `nix_dev` |
| FlakeHub flake metadata | `flakehub_search` |
| Binary cache / substituter status | `binary_cache_status` |
| Nixvim option | `nixvim_options_search` |
| Local flake inputs | `local_flake_inputs` |

> If nixos-tools is unavailable: load `references/flake-schema.md` and `references/flake-patterns.md`
> and state clearly which package versions or option names could not be verified in real time.

---

## Phase 1: Triage — Identify the Flake Mode and Type

### Step 1A: Determine the Distribution Mode

This is the first decision gate. It affects the entire output structure.

```
MODE 1 — Canonical Flake
  The flake is a runnable/buildable artifact that users interact with directly.
  `nix build`, `nix run`, `nix develop` all work against it.
  Choose this for: projects, tools, applications, NixOS configs, devShells.

MODE 2 — Overlays-Only / Library Distribution Flake
  The flake distributes nixpkgs extensions consumed as inputs by other flakes.
  `nix build` and `nix run` do NOT work against it directly — by design.
  Choose this for: organization package registries, upstream patches, language
  ecosystem package sets, custom package collections for downstream consumption.
```

**Decision signals for Mode 2 (overlays-only):**
- User says "distribute packages as an overlay", "inputs-only flake", "library flake"
- The primary consumers are other flakes, not end-users running `nix build`
- The package set spans many packages that should not force full system-level evaluation
- Analogous to: `oxalica/rust-overlay`, `nix-community/emacs-overlay`

**Default to Mode 1 when unsure.** An incorrect Mode 2 choice breaks the CLI surface users
expect. Only select Mode 2 when the distribution model is unambiguous.

> For Mode 2: read `references/overlays-only-pattern.md` in full before proceeding.
> Present the CLI Impact Matrix (§3) to the user so the trade-offs are explicit.

---

### Step 1B: Determine the Primary Output Type

```
A) devShell         → reproducible developer environment              [Mode 1]
B) package          → build and distribute a program or library       [Mode 1]
C) nixosConfig      → full NixOS system configuration                [Mode 1]
D) nixosModule      → reusable NixOS option module                    [Mode 1]
E) overlay          → canonical flake that also builds packages       [Mode 1]
F) homeConfig       → home-manager configuration (standalone/module)  [Mode 1]
G) composite        → multiple of A–F in one flake                   [Mode 1]
H) migration        → legacy default.nix / shell.nix → flake         [Mode 1]
I) overlays-only    → nixpkgs extension library, inputs-only API     [Mode 2]
J) overlay-consumer → downstream flake consuming an overlays-only input [Mode 1+2]
```

For (H), read `references/flake-patterns.md § Migration` before proceeding.
For (I), read `references/overlays-only-pattern.md` before proceeding.
For (J), load `templates/overlay-consumer-integration.nix`.

---

## Phase 2: Architecture Selection

Choose the framework. **Default to flake-parts for all new flakes.**

| Signal | Use |
|---|---|
| New project, no existing framework | **flake-parts** |
| Reading/maintaining existing code using `eachDefaultSystem` | **flake-utils** |
| Trivial single-system one-off | Raw Nix (no framework) |
| Existing flake-parts flake | **flake-parts** |

Load `references/flake-patterns.md` for full framework guidance and boilerplate.

Decision rule: if unsure, use **flake-parts**. It is the modern enterprise standard.

---

## Phase 3: System Architecture

Identify target systems. Query nixos-tools `local_flake_inputs` for user's existing flake context.

Standard system strings:
- `x86_64-linux` — most servers, most Linux desktops
- `aarch64-linux` — ARM servers, Raspberry Pi
- `x86_64-darwin` — Intel Macs
- `aarch64-darwin` — Apple Silicon Macs

With flake-parts: use `systems` input + `perSystem`. Do NOT hardcode system strings in outputs.
With flake-utils: use `flake-utils.lib.eachDefaultSystem` or `eachSystem`.
With raw Nix: hardcode only when single-system is intentional and documented.

---

## Phase 4: Inputs — Composition and Pinning

**Purity rule (non-negotiable):** Flake evaluation is hermetic. No environment variables,
no `~/.config`, no network access during evaluation. All dependencies are declared as `inputs`.

Read `references/purity-and-hermetics.md` before adding any input.

Standard input patterns:
```nix
inputs = {
  nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  # Pin transitive inputs to avoid duplication:
  home-manager = {
    url = "github:nix-community/home-manager";
    inputs.nixpkgs.follows = "nixpkgs";  # ALWAYS follow parent nixpkgs
  };

  flake-parts.url = "github:hercules-ci/flake-parts";
};
```

Use `inputs.<name>.follows = "nixpkgs"` for every input that transitively depends on nixpkgs.
Failure to do this causes duplicate nixpkgs evaluations and bloated closure sizes.

Query nixos-tools `flakehub_search` to verify current canonical URLs for third-party inputs.

---

## Phase 5: Build the Flake

Load the appropriate template from `templates/`:

| Use Case | Template |
|---|---|
| flake-parts devShell or package | `templates/flake-parts-minimal.nix` |
| flake-parts + NixOS config | `templates/flake-parts-nixos.nix` |
| flake-utils devShell or package | `templates/flake-utils-minimal.nix` |
| Home Manager standalone | `templates/home-config-template.nix` |
| **Overlays-only library flake** (Mode 2) | **`templates/overlays-only-flake.nix`** |
| **Consuming an overlays-only flake** (Mode 1+2) | **`templates/overlay-consumer-integration.nix`** |

Populate templates by:
1. Querying nixos-tools for exact package attribute paths (`nixpkgs_search`)
2. Querying nixos-tools for NixOS/HM option names and defaults (`nixos_options_search`)
3. Using the canonical schema from `references/flake-schema.md` for output attributes
4. For Mode 2: verifying no conflicts with existing nixpkgs attr names (`nixpkgs_search`)

---

## Phase 6: Validation Checklist

### Mode 1 — Canonical Flake

- [ ] All `inputs.<name>.follows` are set for inputs that consume nixpkgs
- [ ] No hardcoded system strings when using flake-parts or flake-utils
- [ ] No evaluation-time impurities (env vars, `builtins.readFile` outside src, IFD if avoidable)
- [ ] `nixpkgs.config.allowUnfree` declared explicitly if needed (never implicit)
- [ ] `flake-parts` modules listed under `imports = [ inputs.flake-parts.flakeModules.easyOverlay ]`
  only if actually needed
- [ ] `nixosConfigurations.<name>.system` NOT set (deprecated); use `pkgs.system` from module args
- [ ] `outputs.packages.<system>.default` points to the primary deliverable
- [ ] `outputs.devShells.<system>.default` used for `nix develop` compatibility
- [ ] All package versions verified via nixos-tools, not assumed

### Mode 2 — Overlays-Only Flake (additional checks)

- [ ] **CLI trade-offs disclosed:** User has seen the CLI Impact Matrix from
  `references/overlays-only-pattern.md §3` before adoption decision was made
- [ ] `overlays.default` is a function `final: prev: { ... }`, NOT a derivation
- [ ] `overlays.default` is placed in the `flake = { ... }` block, NOT under `perSystem`
- [ ] All dependencies within the overlay body reference `final`, not `prev`
  (exception: calling the original `prev.<name>` to avoid infinite recursion in overrides)
- [ ] No `prev.attrSet // { ... }` nested merge on recursive package sets
  (use `prev.python3.override { packageOverrides = ...; }` instead)
- [ ] `specialArgs.lib` is NOT used; custom helpers exposed via `flake.lib` or `specialArgs.<customName>`
- [ ] `checks.<system>.*` includes at least one smoke test that instantiates the overlay
  (validates `nix flake check` catches real regressions, not just schema)
- [ ] Smoke-test `pkgs` uses scoped instantiation: `import nixpkgs { overlays = [ self.overlays.default ]; }`
- [ ] `devShells.default` present for overlay contributors (internal tooling, not consumer API)
- [ ] `formatter.<system>` set so `nix fmt` works for contributors
- [ ] If `nixosModules.*` is exposed: module uses `imports`, never bare `import`, for sub-modules
- [ ] If `flakeModules.*` is exposed: clearly documented as flake-parts-only, not standard CLI output
- [ ] `flake-compat` shims (`default.nix`, `shell.nix`) added if legacy nix-shell support is required
- [ ] New package files staged in git (`git add`) before any `nix flake check` invocation
- [ ] Package attribute names verified against nixpkgs via nixos-tools `nixpkgs_search`
  to confirm no collision with existing top-level attrs

---

## Phase 7: CLI Guidance

Always provide the exact commands the user needs to test the flake.
Load `references/cli-workflows.md` for the full command map.

### Mode 1 — Canonical Flake

```bash
nix flake check          # validate schema and build all checks
nix develop              # enter devShell
nix build                # build default package
nix run                  # run default app
nix flake show           # inspect all outputs
nix flake update         # update flake.lock
```

### Mode 2 — Overlays-Only Flake

The available CLI surface is intentionally narrower. Present these commands and
explicitly state which standard commands are NOT available and why.

```bash
# What works:
nix flake check          # runs checks.* smoke tests — primary validation gate
nix develop              # enters internal contributor devShell
nix fmt                  # formats Nix files (formatter.* is set)
nix flake show           # shows overlays.*, nixosModules.*, lib (no packages.*)
nix flake update         # updates flake.lock

# What does NOT work (by design — disclose this to the user):
# nix build              ← no packages.* output; use checks.* for testing
# nix run                ← no apps.* output; consumers run from their own flake
# nix profile install    ← no packages.* output
# nix search .           ← no packages.* to search
```

For consuming the overlay in another flake, direct the user to
`templates/overlay-consumer-integration.nix`.

---

## Reference Files (load as needed)

| File | When to Load |
|---|---|
| `references/flake-schema.md` | Need canonical output attribute names or input schema |
| `references/flake-patterns.md` | Choosing framework, writing modules, migrations |
| `references/purity-and-hermetics.md` | Input composition, IFD, CI/CD constraints |
| `references/cli-workflows.md` | Providing CLI commands to the user |
| `references/nixos-tools-guide.md` | Detailed nixos-tools query strategies |
| `references/overlays-only-pattern.md` | Mode 2: fixed-point law, CLI impact, anti-patterns, scoping |

---

## Output Format

Deliver:
1. **`flake.nix`** — complete, copy-paste-ready, commented
2. **Supporting files** — e.g., `modules/`, `homes/`, `pkgs/` stubs if applicable
3. **CLI commands** — exact commands to build/enter/check the flake
4. **Verification notes** — which values were confirmed via nixos-tools vs. inferred

Never deliver partial expressions. Never truncate with `# ... rest here`. Always complete.
