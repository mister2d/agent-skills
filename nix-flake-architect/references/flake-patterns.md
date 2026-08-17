# Flake Patterns Reference

> Sources: flake.parts (https://flake.parts), flake-utils (https://github.com/numtide/flake-utils),
> Zero to Nix (https://zero-to-nix.com), Official NixOS Wiki (https://wiki.nixos.org/wiki/Flakes)

---

## Table of Contents

1. [Framework Selection](#1-framework-selection)
2. [flake-parts — Modern Standard](#2-flake-parts--modern-standard)
3. [flake-utils — Legacy Compat](#3-flake-utils--legacy-compat)
4. [Raw Nix — No Framework](#4-raw-nix--no-framework)
5. [NixOS Module Authoring](#5-nixos-module-authoring)
6. [Overlay Patterns](#6-overlay-patterns)
7. [Migration: Legacy → Flake](#7-migration-legacy--flake)
8. [Composing Multiple Outputs](#8-composing-multiple-outputs)

---

## 1. Framework Selection

| Criterion | flake-parts | flake-utils | Raw |
|---|---|---|---|
| New project | Default | no | only if trivial |
| Enterprise / multi-output | yes | no | no |
| Reading third-party code | — | read-only | read-only |
| Single system, one package | — | — | acceptable |
| NixOS module development | yes | possible | possible |

Decision: **flake-parts for all new work.** Use flake-utils knowledge only to read/maintain
legacy flakes.

---

## 2. flake-parts — Modern Standard

Created by Hercules CI. Applies the NixOS module system to `flake.nix` itself, giving you
`options`, `config`, and composable modules at the flake layer.

### Minimal devShell

```nix
{
  description = "Project devShell via flake-parts";

  inputs = {
    nixpkgs.url     = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    systems.url     = "github:nix-systems/default";
  };

  outputs = inputs @ { flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        inputs.flake-parts.flakeModules.easyOverlay  # only if producing an overlay
      ];

      systems = import inputs.systems;  # ["x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin"]

      perSystem = { config, pkgs, system, ... }: {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.git
            pkgs.curl
            # Query nixos-tools for exact attribute paths before listing packages
          ];
          shellHook = ''
            echo "Entered dev shell"
          '';
        };
      };

      flake = {
        # Non-system-scoped outputs go here:
        # nixosModules, overlays, lib, templates
      };
    };
}
```

### Minimal Package

```nix
perSystem = { pkgs, ... }: {
  packages.default = pkgs.stdenv.mkDerivation {
    pname   = "my-tool";
    version = "1.0.0";
    src     = ./.;

    buildInputs = [ pkgs.libfoo ];  # verify with nixos-tools: nix {"action":"search","query":"libfoo"}

    buildPhase   = "make";
    installPhase = "make install PREFIX=$out";
  };
};
```

### With NixOS Configuration

```nix
{
  inputs = {
    nixpkgs.url    = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = inputs @ { flake-parts, nixpkgs, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" "aarch64-linux" ];

      flake = {
        nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
          modules = [
            ./hosts/myhost/configuration.nix
            inputs.home-manager.nixosModules.home-manager
            {
              home-manager.useGlobalPkgs    = true;
              home-manager.useUserPackages  = true;
              home-manager.users.alice      = import ./homes/alice.nix;
            }
          ];
        };

        nixosModules.default = import ./modules;
      };
    };
}
```

### flake-parts Module Anatomy

A flake-parts module declares options with `flake-parts-lib.mkPerSystemOption` and
contributes outputs by defining `perSystem`. Both have merge semantics that produce
empty outputs with no error when a definition is guarded or a file is unreachable —
read `flake-parts-semantics.md` before writing one.

```nix
# modules/my-feature.nix — a flake-parts module, not a NixOS module
_: {
  perSystem = { pkgs, ... }: {
    packages.my-feature-pkg = pkgs.callPackage ./pkgs/my-feature { };
  };
}
```

Import in flake:
```nix
imports = [ ./modules/my-feature.nix ];
```

Conditional (`mkIf`-guarded) contributions and the `enable`-option pattern are covered
in `flake-parts-semantics.md` — the guard is the single most common cause of a flake
that evaluates cleanly and produces nothing.

---

## 3. flake-utils — Legacy Compat

Functional approach. Loop over systems with `eachDefaultSystem` or `eachSystem`.

**Do not use for new projects.** Document for reading existing code.

```nix
{
  inputs = {
    nixpkgs.url    = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let pkgs = nixpkgs.legacyPackages.${system};
      in {
        packages.default = pkgs.callPackage ./default.nix {};
        devShells.default = pkgs.mkShell {
          packages = [ pkgs.hello ];
        };
      }
    );
}
```

`eachDefaultSystem` iterates over:
`["x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin"]`

`eachSystem [ "x86_64-linux" "aarch64-linux" ]` — explicit list.

---

## 4. Raw Nix — No Framework

Only for trivial, single-system cases. Hardcode system explicitly and document the constraint.

```nix
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }: let
    system = "x86_64-linux";  # SINGLE SYSTEM: intentional
    pkgs   = nixpkgs.legacyPackages.${system};
  in {
    packages.${system}.default = pkgs.callPackage ./package.nix {};
    devShells.${system}.default = pkgs.mkShell { packages = [ pkgs.gnumake ]; };
  };
}
```

---

## 5. NixOS Module Authoring

A NixOS module is a Nix expression that integrates with the NixOS module system.
Query nixos-tools `nix {"action":"search","type":"options","query":"<option>"}` before defining any option to check for conflicts
with existing NixOS options.

### Module Anatomy

```nix
# modules/my-service.nix
{ config, lib, pkgs, ... }:
let
  cfg = config.services.myService;
in {
  #─── 1. Option Declarations ───────────────────────────────────────────────────
  options.services.myService = {
    enable = lib.mkEnableOption "my custom service";

    port = lib.mkOption {
      type        = lib.types.port;
      default     = 8080;
      description = "TCP port to listen on.";
    };

    package = lib.mkOption {
      type        = lib.types.package;
      default     = pkgs.myService;  # verify attribute path via nixos-tools
      description = "The myService package to use.";
    };
  };

  #─── 2. Implementation ────────────────────────────────────────────────────────
  config = lib.mkIf cfg.enable {
    systemd.services.my-service = {
      description = "My Custom Service";
      wantedBy    = [ "multi-user.target" ];
      after       = [ "network.target" ];
      serviceConfig = {
        ExecStart = "${cfg.package}/bin/my-service --port ${toString cfg.port}";
        DynamicUser = true;
        Restart     = "on-failure";
      };
    };

    networking.firewall.allowedTCPPorts = [ cfg.port ];
  };
}
```

### Accessing Module from Flake

```nix
# In flake outputs:
nixosModules.myService = ./modules/my-service.nix;

# Consumer's flake:
{
  inputs.my-flake.url = "github:me/my-flake";
  outputs = { nixpkgs, my-flake, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      modules = [
        my-flake.nixosModules.myService
        { services.myService.enable = true; }
      ];
    };
  };
}
```

---

## 6. Overlay Patterns

Overlays extend or override nixpkgs. The function signature is always `final: prev:`.

```nix
overlays.default = final: prev: {
  # Add a package not in nixpkgs:
  my-tool = final.callPackage ./pkgs/my-tool {};

  # Override a package version:
  openssl = prev.openssl.overrideAttrs (old: {
    version = "3.3.0";
    src = final.fetchurl { url = "..."; sha256 = "..."; };
  });
};
```

**Apply overlay in nixosConfiguration:**
```nix
nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
  modules = [
    { nixpkgs.overlays = [ self.overlays.default ]; }
    ./configuration.nix
  ];
};
```

**Apply in flake-parts devShell:**
```nix
perSystem = { system, ... }: let
  pkgs = import nixpkgs {
    inherit system;
    overlays = [ self.overlays.default ];
  };
in {
  devShells.default = pkgs.mkShell { packages = [ pkgs.my-tool ]; };
};
```

### Overlay Scope: Global vs Scoped Instantiation

Global (`nixpkgs.overlays`) versus scoped (a local `import nixpkgs { overlays = [ … ]; }`)
changes both cache behavior and blast radius. Covered in full, with the decision rule, in
`overlays-only-pattern.md §7`.

---

## 7. Migration: Legacy → Flake

### `default.nix` / `shell.nix` → `flake.nix`

Legacy pattern:
```nix
# shell.nix
{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell { packages = [ pkgs.git pkgs.curl ]; }
```

Flake equivalent:
```nix
# flake.nix
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  inputs.flake-parts.url = "github:hercules-ci/flake-parts";
  outputs = inputs: inputs.flake-parts.lib.mkFlake { inherit inputs; } {
    systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
    perSystem = { pkgs, ... }: {
      devShells.default = pkgs.mkShell {
        packages = [ pkgs.git pkgs.curl ];
      };
    };
  };
}
```

Migration steps:
1. Run `nix flake init` to scaffold `flake.nix`
2. Replace `import <nixpkgs> {}` with `nixpkgs.legacyPackages.${system}`, or with the
   `pkgs` argument inside `perSystem` — `pkgs` exists only there, never at the top level
   of a flake-parts module (see `flake-parts-semantics.md`)
3. Move `buildInputs` / `packages` verbatim — attribute paths are unchanged in nixpkgs
4. Verify package attribute paths via nixos-tools `nix {"action":"search","query":"<name>"}` (names may have changed)
5. Add `flake.lock` to version control
6. Delete `shell.nix` and `default.nix` after validation

### `nixos-rebuild` with Legacy Config → Flake

```nix
# Add to flake.nix outputs:
nixosConfigurations.myhostname = nixpkgs.lib.nixosSystem {
  modules = [ /etc/nixos/configuration.nix ];  # path to existing config
};
```

Then switch:
```bash
nixos-rebuild switch --flake .#myhostname
```

---

## 8. Composing Multiple Outputs

For a monorepo or multi-component project:

```
my-project/
├── flake.nix
├── pkgs/
│   ├── tool-a/default.nix
│   └── tool-b/default.nix
├── modules/
│   └── my-module.nix
├── hosts/
│   └── server1/configuration.nix
└── homes/
    └── alice.nix
```

```nix
# flake.nix (flake-parts composite)
flake-parts.lib.mkFlake { inherit inputs; } {
  systems = import inputs.systems;

  perSystem = { pkgs, ... }: {
    packages = {
      tool-a = pkgs.callPackage ./pkgs/tool-a {};
      tool-b = pkgs.callPackage ./pkgs/tool-b {};
      default = self.packages.${pkgs.system}.tool-a;
    };
    devShells.default = pkgs.mkShell {
      inputsFrom = [ self.packages.${pkgs.system}.tool-a ];
      packages   = [ pkgs.nixfmt-rfc-style ];
    };
    checks.tool-a-test = pkgs.callPackage ./pkgs/tool-a/test.nix {};
    formatter = pkgs.nixfmt-rfc-style;
  };

  flake = {
    nixosModules.default   = ./modules/my-module.nix;
    overlays.default       = final: prev: { inherit (self.packages.${final.system}) tool-a; };
    nixosConfigurations.server1 = nixpkgs.lib.nixosSystem {
      modules = [ ./hosts/server1/configuration.nix self.nixosModules.default ];
    };
    templates.default = {
      path        = ./templates/basic;
      description = "Basic project template";
    };
  };
}
```
