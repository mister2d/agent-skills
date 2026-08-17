# Purity and Hermetics in Nix Flakes

> Source: nix.dev (https://nix.dev/concepts/flakes), Nix Reference Manual
> Understanding purity is the single most important concept for writing correct flakes.

---

## Table of Contents

1. [The Fundamental Rule](#the-fundamental-rule)
2. [What Is Forbidden During Evaluation](#what-is-forbidden-during-evaluation)
3. [The Purity Contract for `inputs`](#the-purity-contract-for-inputs)
4. [`allowUnfree` and Broken Packages](#allowunfree-and-broken-packages)
5. [Import From Derivation (IFD)](#import-from-derivation-ifd)
6. [`nixConfig` — Substituters and Trust](#nixconfig--substituters-and-trust)
7. [Passing Impurities Explicitly (When Unavoidable)](#passing-impurities-explicitly-when-unavoidable)
8. [CI/CD Purity Enforcement](#cicd-purity-enforcement)
9. [Sensitive Data — Secrets](#sensitive-data--secrets)

---

## The Fundamental Rule

Flake evaluation is **hermetic**. The Nix evaluator enforces that:

1. All dependencies are declared in `inputs`
2. No environment variables are readable during evaluation
3. No files outside the flake directory are readable unless passed explicitly
4. Network access during evaluation is forbidden (fetchers are tracked in `flake.lock`)
5. The filesystem is read-only during the build phase (in the Nix sandbox)

This is a feature, not a limitation. It is the guarantee that `nix build` produces identical
output on every machine, every time.

---

## What Is Forbidden During Evaluation

| Action | Legacy Nix | Flakes |
|---|---|---|
| `builtins.getEnv "HOME"` | Works (returns value) | Returns `""` (empty) |
| `import <nixpkgs> {}` | Works (uses NIX_PATH) | **Fails** — no NIX_PATH |
| Reading `~/.config/nix.conf` | Works | **Forbidden** |
| Fetching from network without hash | Works (impure) | **Forbidden** |
| Relative `import ./file.nix` | Works if on path | Works (within flake src) |
| `builtins.currentSystem` | Available | Available (but avoid in outputs) |

---

## The Purity Contract for `inputs`

Every external dependency — nixpkgs, home-manager, a third-party library — **must** be
declared as an input. There is no other way to bring in external Nix code in a pure flake.

```nix
# WRONG: importing nixpkgs from NIX_PATH (impure, breaks in flakes)
let pkgs = import <nixpkgs> {};

# CORRECT: consuming nixpkgs from flake input
outputs = { nixpkgs, ... }: let
  pkgs = nixpkgs.legacyPackages.x86_64-linux;
```

---

## `allowUnfree` and Broken Packages

These must be declared explicitly. They cannot be read from `~/.config/nixpkgs/config.nix`.

```nix
# In a module:
nixpkgs.config.allowUnfree = true;

# In a perSystem context (flake-parts):
perSystem = { system, ... }: let
  pkgs = import nixpkgs {
    inherit system;
    config.allowUnfree = true;
  };
in { ... };

# Per-package override (preferred — minimizes surface):
environment.systemPackages = [
  (pkgs.vscode.override { commandLineArgs = ""; })
  pkgs.vscode-with-extensions  # if unfree
];
nixpkgs.config.allowUnfreePredicate = pkg:
  builtins.elem (lib.getName pkg) [ "vscode" "slack" ];
```

---

## Import From Derivation (IFD)

IFD occurs when a Nix expression imports the result of a derivation (`import (pkgs.runCommand ...)`).

This is sometimes necessary (e.g., generating Nix expressions from other languages) but has costs:
- Evaluation becomes multi-phase — slow in large repos
- Breaks `nix flake check --no-build` (cannot evaluate without building)
- Can break remote evaluation (e.g., in hydra or garnix without build access)

**When to avoid IFD:**
- Avoid in library flakes meant to be consumed as inputs
- Avoid in nixosModules (consumers won't expect build requirements at eval time)

**When IFD is acceptable:**
- Package definitions that generate Nix from lock files (e.g., `dream2nix`, `poetry2nix`)
- CI pipelines where the build host controls evaluation

If you use IFD, document it explicitly with a comment in the flake.

---

## `nixConfig` — Substituters and Trust

```nix
nixConfig = {
  extra-substituters      = [ "https://my-cache.cachix.org" ];
  extra-trusted-public-keys = [ "my-cache.cachix.org-1:abc123..." ];
};
```

Nix will **prompt the user** to accept these additions if the flake is not in their trusted list.
This is intentional security behavior — not a bug.

Rules:
- Only add `nixConfig` when you maintain the binary cache and want consumers to use it
- Do not add untrusted or third-party cache URLs without verification
- The official `cache.nixos.org` is already trusted by default; do not re-add it

---

## Passing Impurities Explicitly (When Unavoidable)

Rarely, a build needs runtime context that is inherently impure (machine hostname, secrets).
The correct pattern is to pass these at `nixosSystem` instantiation time, never at eval time.

```nix
# BAD: impure environment read during evaluation
let hostname = builtins.getEnv "MY_HOSTNAME";  # returns "" in flakes

# CORRECT: use NixOS module options which are set in configuration.nix
# networking.hostName = "myserver";  # set explicitly in config

# CORRECT: pass specialArgs for rarely-needed non-option values
nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
  specialArgs = { inherit inputs; customArg = "value"; };
  modules = [ ./configuration.nix ];
};
```

---

## CI/CD Purity Enforcement

In CI (GitHub Actions, Gitlab CI, Garnix, Hercules CI):

```yaml
# GitHub Actions — correct nix flake check invocation
- run: nix flake check --no-build  # evaluates without building (fast gate)
- run: nix build .#default         # explicit build
```

Never pass `--impure` in CI. If a build requires impurity, it is a design flaw.

Rules for CI:
- Never pass `--impure`
- Never set `NIX_PATH` manually to override nixpkgs
- Pin all inputs via `flake.lock` — never use `nix flake update` in CI without a PR review step
- Use `nix flake check` as the entry point, not `nix build` for comprehensive validation

---

## Sensitive Data — Secrets

Secrets (passwords, API keys, TLS certificates) MUST NOT be stored in the Nix store.
The Nix store is world-readable.

Correct patterns:
- `sops-nix` — decrypt secrets at activation time using age/GPG keys
- `agenix` — similar approach, simpler key management
- `systemd` `EnvironmentFile=` — load secrets from `/run/secrets/` at service start
- `NixOS` `security.acme` — automates TLS without storing keys in the store

Never embed secrets in `configuration.nix`, `flake.nix`, or any tracked Nix file.
