# nixos-tools Query Guide

The `nixos-tools` MCP server is the primary source of ground truth for this skill.
It provides real-time, accurate information about the NixOS ecosystem.
**Query it before writing any Nix expression involving packages, options, or external flakes.**

---

## Table of Contents

1. [Package Lookup](#1-package-lookup)
2. [NixOS Options](#2-nixos-options)
3. [Home Manager Options](#3-home-manager-options)
4. [nix-darwin Options](#4-nix-darwin-options)
5. [Nix Built-in Functions](#5-nix-built-in-functions)
6. [FlakeHub](#6-flakehub)
7. [Binary Cache Status](#7-binary-cache-status)
8. [NixOS Wiki](#8-nixos-wiki)
9. [nix.dev Tutorials](#9-nixdev-tutorials)
10. [Local Flake Context](#10-local-flake-context)
11. [Nixvim Options](#11-nixvim-options)
12. [Query Patterns and Pitfalls](#12-query-patterns-and-pitfalls)

---

## 1. Package Lookup

**Resource:** `nixpkgs_search`
**Also:** `package_versions`

Use to resolve:
- Exact attribute path in nixpkgs (e.g., `pkgs.python312` not `pkgs.python`)
- Current version
- Whether a package exists in the channel you are targeting

```
Query: nixpkgs_search "rustc"
→ Returns: attribute path, version, description, available systems

Query: package_versions "nodejs"
→ Returns: all available nodejs variants (nodejs_18, nodejs_20, nodejs_22, etc.)
```

**When to query:**
- Before adding any package to `buildInputs`, `packages`, `nativeBuildInputs`, `environment.systemPackages`
- When the user names a tool (e.g., "add ripgrep") — verify attribute path is `pkgs.ripgrep`
- When multiple versions exist (Python, Node.js, JDK, Ruby) — confirm which variant is correct

**Common naming traps to verify:**
- Python: `pkgs.python3` (meta), `pkgs.python312` (specific), `pkgs.python3Packages.requests`
- Node.js: `pkgs.nodejs` (current LTS), `pkgs.nodejs_22`
- Java: `pkgs.jdk`, `pkgs.jdk21`, `pkgs.temurin-bin`
- Database clients: `pkgs.postgresql`, `pkgs.postgresql_16` (server), `pkgs.pgcli` (client)
- GCC: `pkgs.gcc`, `pkgs.gcc14` — rarely needed directly, prefer `pkgs.stdenv.cc`

---

## 2. NixOS Options

**Resource:** `nixos_options_search`

Use to resolve:
- Whether a NixOS option exists before declaring it in a module or configuration
- The option's type, default value, and example
- Whether an option has been deprecated and what replaced it

```
Query: nixos_options_search "services.postgresql"
→ Returns: all postgresql service options with types and defaults

Query: nixos_options_search "networking.firewall.allowedTCPPorts"
→ Returns: type (listOf port), default ([]), description
```

**When to query:**
- Before writing `services.X.enable = true` — verify `X` is a real NixOS service option
- Before setting any `networking.*`, `boot.*`, `hardware.*`, `security.*` option
- When the user asks "how do I configure X in NixOS" — search options first, then write config

**Critical: Do not guess NixOS option names.** Guessed option names silently evaluate to no-ops
in NixOS if they are not declared options (unless `lib.mkOption` throws on unknown attrs).
Wrong option names waste debugging time. Always verify.

---

## 3. Home Manager Options

**Resource:** `home_manager_options_search`

Use to resolve:
- Home Manager program options (e.g., `programs.git`, `programs.zsh`)
- Service options for user-level services
- File management options (`home.file`, `xdg.configFile`)

```
Query: home_manager_options_search "programs.git"
→ Returns: all programs.git.* options with types and examples

Query: home_manager_options_search "wayland.windowManager.hyprland"
→ Returns: HM-specific Hyprland module options
```

**When to query:**
- Whenever the user asks about Home Manager configuration
- Before writing any `programs.*` or `services.*` block in a `home.nix`
- To distinguish HM options from NixOS options (both use similar namespaces but are different)

---

## 4. nix-darwin Options

**Resource:** `darwin_options_search`

macOS-specific system management via nix-darwin. Options are different from NixOS.

```
Query: darwin_options_search "services.nix-daemon"
→ Returns: macOS nix-daemon service options

Query: darwin_options_search "homebrew"
→ Returns: nix-darwin Homebrew integration options
```

**When to query:** Any time the user mentions macOS, Apple Silicon, `darwin-rebuild`, or nix-darwin.
NixOS options do NOT apply on macOS. Always verify against darwin options.

---

## 5. Nix Built-in Functions

**Resource:** `noogle_search`

Noogle provides function signatures with types (Haskell-style) for:
- `builtins.*` functions
- `nixpkgs.lib.*` functions
- `lib.types.*` for module options

```
Query: noogle_search "lib.mkOption"
→ Returns: type signature, description, arguments

Query: noogle_search "builtins.mapAttrs"
→ Returns: (String → a → b) → AttrSet → AttrSet  (with explanation)
```

**When to query:**
- Before using any `lib.*` function you are not certain about
- When writing module option types (verify `lib.types.X` exists)
- When constructing complex attribute set manipulations

---

## 6. FlakeHub

**Resource:** `flakehub_search`

FlakeHub is a flake registry with versioning support. Use to find current canonical URLs
and verify a flake exists and is maintained.

```
Query: flakehub_search "home-manager"
→ Returns: FlakeHub URL, current version, publisher

Query: flakehub_search "rust-overlay"
→ Returns: oxalica/rust-overlay entry, URL format
```

**When to query:**
- When adding a third-party input and verifying its canonical source
- When the user asks about a flake by name and you need its URL
- To provide FlakeHub URLs as an alternative to direct GitHub URLs (FlakeHub provides stable versioning)

---

## 7. Binary Cache Status

**Resource:** `binary_cache_status`

Verifies whether a derivation is available as a pre-built binary in the NixOS binary cache.
If not cached, building locally may take significant time.

```
Query: binary_cache_status "rust"
→ Returns: cache hit status for various rust derivations on x86_64-linux, aarch64-linux, etc.
```

**When to query:**
- When the user is adding a large package (compilers, LLVM, etc.) and may not expect a long build
- When recommending an unfree or custom package that won't be in the public cache
- To inform the user whether they need a Cachix or private binary cache

---

## 8. NixOS Wiki

**Resource:** `nixos_wiki`

The official wiki at `wiki.nixos.org` (not the deprecated `nixos.wiki`).

```
Query: nixos_wiki "NVIDIA"
→ Returns: NVIDIA driver configuration guide

Query: nixos_wiki "Impermanence"
→ Returns: impermanence pattern (tmpfs root, etc.)
```

**When to query:**
- When the user asks about a complex NixOS topic (hardware, desktop, specific service)
- Before writing complex hardware configurations (GPU, WiFi, Bluetooth)
- For community patterns not yet in the official manual

---

## 9. nix.dev Tutorials

**Resource:** `nix_dev`

Official Nix tutorials and guides at `nix.dev`.

```
Query: nix_dev "flakes"
→ Returns: official flake tutorial content

Query: nix_dev "derivations"
→ Returns: derivation authoring tutorial
```

**When to query:**
- When the user is learning and needs a conceptual foundation
- When you need to confirm the official recommended approach for a workflow
- For packaging tutorials (stdenv, mkDerivation, builders)

---

## 10. Local Flake Context

**Resource:** `local_flake_inputs`

Reads the user's existing `flake.nix` and `flake.lock` to understand their current setup.

```
Query: local_flake_inputs
→ Returns: current inputs, their locked revisions, existing outputs structure
```

**When to query:**
- At the start of any task involving an existing flake (migration, addition, fix)
- Before suggesting new inputs — check if the input already exists under a different name
- To avoid suggesting a nixpkgs channel that conflicts with what they already use

---

## 11. Nixvim Options

**Resource:** `nixvim_options_search`

Nixvim configures Neovim via the NixOS module system.

```
Query: nixvim_options_search "plugins.treesitter"
→ Returns: nixvim treesitter plugin options
```

**When to query:** Only when the user asks about Neovim or Nixvim configuration.

---

## 12. Query Patterns and Pitfalls

### Chain queries for compound tasks

Example: "Add a PostgreSQL dev environment to my flake"

1. `nixpkgs_search "postgresql"` → confirm attribute path + version
2. `local_flake_inputs` → check existing inputs and nixpkgs channel
3. `nixos_options_search "services.postgresql"` → if adding server to NixOS config
4. `binary_cache_status "postgresql"` → inform if pre-built binaries available

### Disambiguation

- `pkgs.postgresql` — the PostgreSQL server
- `pkgs.pgcli` — interactive PostgreSQL CLI client
- `pkgs.postgresql.lib` — the PostgreSQL client libraries for building other packages
- `pkgs.libpq` — the C library (same as above, sometimes needed explicitly)

Query nixos-tools to confirm before writing any attribute path.

### Handling "not found" results

If `nixpkgs_search` returns no result:
1. Try alternate spellings (kebab-case vs camelCase: `nodejs` vs `node-js`)
2. Try `noogle_search` to see if it's a lib function
3. Try `nixos_wiki` to find the canonical package name
4. If truly not in nixpkgs, suggest building from source via `mkDerivation` or a flake input

Never fabricate a package attribute path. A wrong attribute path produces an evaluation error.
