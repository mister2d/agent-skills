# Flake Schema Reference

> Source: Nix Reference Manual — https://nixos.org/manual/nix/stable/command-ref/new-cli/nix3-flake.html
> This document encodes the canonical schema. Always prefer nixos-tools for live verification.

---

## Table of Contents

1. [`flake.nix` Top-Level Structure](#flakenix-top-level-structure)
2. [`inputs` Schema](#inputs-schema)
3. [`outputs` Schema](#outputs-schema)
4. [`nixConfig`](#nixconfig)
5. [`self` — The Flake's Own Output Set](#self--the-flakes-own-output-set)
6. [`flake.lock`](#flakelock)

---

## `flake.nix` Top-Level Structure

A `flake.nix` must be a Nix attribute set with exactly these top-level keys:

```nix
{
  description = "...";   # Optional. Human-readable string.
  inputs  = { ... };     # Required. Dependency declarations.
  outputs = { ... };     # Required. A function of inputs producing outputs.
  nixConfig = { ... };   # Optional. Nix evaluator settings (e.g., substituters).
}
```

---

## `inputs` Schema

Each input is an attribute set:

```nix
inputs.<name> = {
  url     = "<flake-ref>";        # Required. Canonical flake URL.
  inputs  = { ... };             # Optional. Override transitive inputs.
  follows = "<other-input>";     # Shorthand: pin this input's nixpkgs to another.
  flake   = true | false;        # Optional. false = treat as non-flake source.
};
```

### Flake URL Formats

| Format | Example |
|---|---|
| GitHub | `github:NixOS/nixpkgs/nixos-unstable` |
| GitHub (tagged) | `github:NixOS/nixpkgs/23.11` |
| GitHub (commit) | `github:NixOS/nixpkgs/<sha>` |
| GitLab | `gitlab:<owner>/<repo>` |
| Sourcehut | `sourcehut:<owner>/<repo>` |
| Local path | `path:/absolute/path/to/flake` |
| FlakeHub | `https://flakehub.com/f/<owner>/<repo>/*.tar.gz` |
| tarball | `https://example.com/archive.tar.gz` |
| Indirect (registry) | `nixpkgs` (resolved via flake registry) |

**Production rule:** Never use indirect (registry) URLs in production flakes.
Always use explicit `github:` or `https://flakehub.com/` URLs so `flake.lock` is fully
reproducible without relying on registry state.

### `follows` — Deduplication

```nix
inputs = {
  nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  home-manager = {
    url = "github:nix-community/home-manager";
    inputs.nixpkgs.follows = "nixpkgs";  # Prevents a second nixpkgs in the closure
  };
};
```

Rule: every input that transitively depends on nixpkgs MUST have `inputs.nixpkgs.follows = "nixpkgs"`
unless you intentionally want that input to use a different nixpkgs version (rare).

---

## `outputs` Schema

`outputs` is a function that receives inputs and returns an attribute set:

```nix
outputs = { self, nixpkgs, ... }@inputs: {
  # outputs here
};
```

### Canonical Output Attributes

All system-specific outputs use the string `<system>` as a key, e.g. `"x86_64-linux"`.

#### packages

```nix
packages.<system>.<name> = <derivation>;
packages.<system>.default = <derivation>;  # used by `nix build` without a name
```

#### devShells

```nix
devShells.<system>.<name> = <derivation>;
devShells.<system>.default = <derivation>;  # used by `nix develop` without a name
```

#### apps

```nix
apps.<system>.<name> = {
  type = "app";
  program = "${<derivation>}/bin/<executable>";
};
apps.<system>.default = { ... };  # used by `nix run` without a name
```

#### nixosConfigurations

```nix
nixosConfigurations.<hostname> = nixpkgs.lib.nixosSystem {
  system = "x86_64-linux";
  modules = [ ./configuration.nix ];
};
```

> **Deprecation note:** The `system` argument to `nixosSystem` is deprecated in favor of
> setting `nixpkgs.hostPlatform` inside a module. Prefer the module approach for new configs.

#### nixosModules

```nix
nixosModules.<name> = ./path/to/module.nix;
nixosModules.default = ./module.nix;  # convention for single-module flakes
```

A NixOS module is a function `{ config, lib, pkgs, ... }: { options = {}; config = {}; }`.

#### overlays

```nix
overlays.<name> = final: prev: {
  myPackage = final.callPackage ./pkgs/my-package {};
};
overlays.default = final: prev: { ... };
```

`final` — the fixed point (fully resolved nixpkgs).
`prev` — the previous layer (use to call `prev.callPackage` for override access).

#### checks

```nix
checks.<system>.<name> = <derivation>;
```

Derivations under `checks` are built by `nix flake check`. Use for tests, linters, formatters.

#### formatter

```nix
formatter.<system> = pkgs.nixfmt-rfc-style;  # or pkgs.alejandra
```

Used by `nix fmt`.

#### lib

```nix
lib = {
  myHelper = args: ...;
};
```

Not system-scoped. Pure Nix functions for consumers of this flake.

#### templates

```nix
templates.<name> = {
  path = ./templates/<name>;
  description = "...";
};
templates.default = { ... };  # used by `nix flake init` without a name
```

---

## `nixConfig`

```nix
nixConfig = {
  extra-substituters = [ "https://cache.nixos.org" "https://mycache.example.com" ];
  extra-trusted-public-keys = [ "cache.nixos.org-1:..." ];
};
```

`nixConfig` settings are applied during evaluation and require user confirmation if they
extend the trusted substituters. Do not abuse this mechanism.

---

## `self` — The Flake's Own Output Set

`self` is a special argument in `outputs` that refers to the flake's own evaluated outputs.
Common uses:

```nix
# Reference own module from nixosConfiguration
modules = [ self.nixosModules.myModule ];

# Reference own source tree
src = self;

# Reference own packages as overlay
overlays.default = final: prev: { inherit (self.packages.${final.system}) myPkg; };
```

---

## `flake.lock`

Machine-managed. Never edit by hand. Tracks exact revisions and content hashes for all inputs.

Update commands:
```bash
nix flake update              # update all inputs
nix flake lock --update-input nixpkgs   # update one input
```

The `flake.lock` file MUST be committed to version control. It is the reproducibility guarantee.
