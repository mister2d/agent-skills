# nixos-tools Query Guide

The `nixos-tools` MCP server is this skill's source of ground truth. Query it before
writing any Nix expression involving package attribute paths, option names, or external
flakes — training data lags nixpkgs by months, and a wrong name produces an evaluation
error rather than a graceful failure.

Two tools are exposed. Everything routes through `action` on the first one:

- **`mcp__nixos-tools__nix`** — `action` is one of `search`, `info`, `stats`, `browse`,
  `channels`, `flake-inputs`, `cache`, `store`. Narrow with `source` (which dataset) and
  `type` (which kind of record within it).
- **`mcp__nixos-tools__nix_versions`** — package version history from NixHub, including
  which nixpkgs commit shipped a given version.

---

## Table of Contents

1. [Action and source matrix](#1-action-and-source-matrix)
2. [Packages](#2-packages)
3. [NixOS options](#3-nixos-options)
4. [Home Manager, nix-darwin, Nixvim](#4-home-manager-nix-darwin-nixvim)
5. [Nix built-in and lib functions](#5-nix-built-in-and-lib-functions)
6. [Flakes and FlakeHub](#6-flakes-and-flakehub)
7. [Local flake context](#7-local-flake-context)
8. [Binary cache and store](#8-binary-cache-and-store)
9. [Wiki and nix.dev](#9-wiki-and-nixdev)
10. [Query patterns and pitfalls](#10-query-patterns-and-pitfalls)

---

## 1. Action and source matrix

| Action | What it does | Valid `source` values |
|---|---|---|
| `search` | keyword lookup | `nixos` (default), `home-manager`, `darwin`, `nixvim`, `flakes`, `flakehub`, `wiki`, `nix-dev`, `noogle`, `nixhub` |
| `info` | details for one exact name | same as `search` |
| `browse` | walk an option hierarchy by prefix | `home-manager`, `darwin`, `nixvim`, `noogle` only |
| `stats` | counts of packages and options | `nixos`, `home-manager`, `darwin`, `nixvim` |
| `channels` | list available channels and their indexed commits | — |
| `flake-inputs` | read the current project's flake inputs | a flake directory path, or omit for the current project |
| `cache` | binary cache availability | takes `system` and `version` |
| `store` | read a file or list a directory under `/nix/store/` | — |

Other parameters: `channel` (default `unstable`; also `stable` or a release like `25.05`),
`type` (sub-kind — see each section below), and `limit` (1–100, or up to 2000 for
`flake-inputs` and `store` reads).

---

## 2. Packages

```
nix {"action":"search","query":"rustc"}
→ attribute path, version, description

nix {"action":"info","query":"rustc"}
→ full detail for one package

nix {"action":"info","query":"rustc","channel":"25.05"}
→ whether it exists in a specific channel

nix {"action":"search","query":"ripgrep","type":"programs"}
→ which package provides a given binary

nix_versions {"package":"nodejs","version":"22.11.0"}
→ which nixpkgs commit shipped that version, and its attribute path
```

Query before adding any package to `buildInputs`, `nativeBuildInputs`, `packages`, or
`environment.systemPackages`; whenever the user names a tool ("add ripgrep"); and
whenever several versions coexist.

Naming traps worth verifying rather than recalling:

- Python: `pkgs.python3` (meta), `pkgs.python312` (specific), `pkgs.python3Packages.requests`
- Node.js: `pkgs.nodejs` (current LTS), `pkgs.nodejs_22`
- Java: `pkgs.jdk`, `pkgs.jdk21`, `pkgs.temurin-bin`
- Postgres: `pkgs.postgresql` / `pkgs.postgresql_16` (server), `pkgs.pgcli` (client)
- GCC: `pkgs.gcc`, `pkgs.gcc14` — rarely needed directly; prefer `pkgs.stdenv.cc`

---

## 3. NixOS options

```
nix {"action":"search","query":"services.postgresql","type":"options"}
→ all matching options with types and defaults

nix {"action":"info","query":"networking.firewall.allowedTCPPorts","type":"option"}
→ type (listOf port), default ([]), description
```

Query before writing `services.<x>.enable = true`, and before setting any `networking.*`,
`boot.*`, `hardware.*`, or `security.*` value.

**Do not guess NixOS option names.** A guessed name that happens not to be a declared
option is reported at evaluation as an unmatched definition, and the config silently
fails to do what was intended.

---

## 4. Home Manager, nix-darwin, Nixvim

Same actions, different `source`:

```
nix {"action":"search","query":"programs.git","source":"home-manager"}
nix {"action":"browse","query":"programs.git","source":"home-manager"}
→ walk the option tree under a prefix

nix {"action":"search","query":"homebrew","source":"darwin"}
nix {"action":"search","query":"plugins.treesitter","source":"nixvim"}
```

Home Manager and NixOS use similar namespaces (`programs.*`, `services.*`) for different
option sets — confirm which system an option belongs to before writing it. NixOS options
do not apply on macOS; use `source: "darwin"` whenever the user mentions macOS, Apple
Silicon, or `darwin-rebuild`.

`browse` is the efficient way to explore a large option namespace: it lists the tree
under a prefix instead of returning scattered keyword matches.

---

## 5. Nix built-in and lib functions

```
nix {"action":"search","query":"mkOption","source":"noogle"}
nix {"action":"search","query":"mapAttrs","source":"noogle"}
→ type signature, description, arguments
```

Noogle covers `builtins.*`, `lib.*`, and `lib.types.*`. Query before using a `lib`
function you are not certain about, and when verifying that a `lib.types.<x>` exists for
a module option.

---

## 6. Flakes and FlakeHub

```
nix {"action":"search","query":"home-manager","source":"flakehub"}
→ FlakeHub URL, current version, publisher

nix {"action":"search","query":"rust-overlay","source":"flakes"}
```

Use when adding a third-party input and verifying its canonical source, or when the user
names a flake and you need its URL. FlakeHub provides stable semver-style pinning as an
alternative to a bare GitHub URL.

---

## 7. Local flake context

```
nix {"action":"flake-inputs"}
→ the current project's inputs and their locked revisions

nix {"action":"flake-inputs","type":"ls","query":"nixpkgs"}
nix {"action":"flake-inputs","type":"read","query":"nixpkgs:lib/modules.nix"}
→ list or read files inside a locked input
```

Run at the start of any task touching an existing flake — migration, addition, or fix.
It prevents suggesting an input that already exists under another name, or a nixpkgs
channel that conflicts with the one already locked.

`type: "read"` against an input is the fastest way to check what a locked dependency
actually does, rather than inferring it from its documentation.

---

## 8. Binary cache and store

```
nix {"action":"cache","query":"rustc","system":"x86_64-linux"}
→ whether a pre-built binary exists, or whether the user builds locally

nix {"action":"store","type":"ls","query":"/nix/store/<hash>-name"}
nix {"action":"store","type":"read","query":"/nix/store/<hash>-name/file"}
```

Check the cache when adding a large package (compilers, LLVM, CUDA), when recommending
an unfree or custom package that will not be in the public cache, and to tell the user
whether they need Cachix or a private cache.

`store` reads are useful for inspecting a derivation's actual contents — see
`troubleshooting.md §6` for using it to confirm what a `src` path really holds.

---

## 9. Wiki and nix.dev

```
nix {"action":"search","query":"NVIDIA","source":"wiki"}
nix {"action":"search","query":"flakes","source":"nix-dev"}
nix {"action":"info","query":"tutorials/nix-language","source":"nix-dev"}
```

The wiki (`wiki.nixos.org`, not the deprecated `nixos.wiki`) carries community patterns
for hardware and desktop configuration — GPU, WiFi, Bluetooth, impermanence. nix.dev
carries the official tutorials; use it to confirm the recommended approach for a workflow
rather than the merely popular one.

---

## 10. Query patterns and pitfalls

### Chain queries for compound tasks

"Add a PostgreSQL dev environment to my flake":

1. `nix {"action":"search","query":"postgresql"}` — confirm attribute path and version
2. `nix {"action":"flake-inputs"}` — check existing inputs and nixpkgs channel
3. `nix {"action":"search","query":"services.postgresql","type":"options"}` — if adding a NixOS service
4. `nix {"action":"cache","query":"postgresql"}` — warn about build time if uncached

### Disambiguation

- `pkgs.postgresql` — the server
- `pkgs.pgcli` — interactive client
- `pkgs.postgresql.lib` — client libraries for building other packages
- `pkgs.libpq` — the C library, sometimes needed explicitly

Confirm with `info` before writing any attribute path.

### Channel awareness

`channel` defaults to `unstable`. A package that exists in unstable may be absent from
the release the user actually pins, so pass `channel` explicitly when the flake targets a
release. `nix {"action":"channels"}` lists what is available and which commit each
channel indexed.

### Handling "not found"

1. Try alternate spellings — kebab-case versus camelCase (`nodejs` versus `node-js`)
2. Try `source: "noogle"` in case it is a lib function rather than a package
3. Try `source: "wiki"` to find the canonical package name
4. If genuinely absent from nixpkgs, propose building it via `mkDerivation` or adding a
   flake input

Never fabricate a package attribute path or an option name. Report the failed lookup and
mark the value as unverified instead.
