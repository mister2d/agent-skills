# Template: flake-parts — Minimal (devShell / Package)
#
# Use case: single project needing a reproducible dev environment and/or a built package.
# Framework: flake-parts (modern standard — preferred for all new work)
#
# Before using this template:
#   1. Verify all package attribute paths via nixos-tools `nix {"action":"search","query":"<name>"}`
#   2. Update `description` to reflect the project
#   3. Choose a nixpkgs channel:
#      - "nixos-unstable" — latest packages, less stability guarantee
#      - "nixos-24.11"    — stable channel, verify current release via nixos-tools
#
{
  description = "REPLACE_ME: short project description";

  # ──────────────────────────────────────────────────────────────────────────────
  # Inputs — all external dependencies
  # ──────────────────────────────────────────────────────────────────────────────
  inputs = {
    nixpkgs.url     = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";

    # The `systems` flake provides the canonical list of target architectures.
    # Remove if you want to pin to a specific system list instead.
    systems.url     = "github:nix-systems/default";
  };

  # ──────────────────────────────────────────────────────────────────────────────
  # Outputs — the function that produces all flake outputs
  # ──────────────────────────────────────────────────────────────────────────────
  outputs = inputs @ { flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {

      # Target architectures. `import inputs.systems` expands to:
      # [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ]
      systems = import inputs.systems;

      # ────────────────────────────────────────────────────────────────────────
      # perSystem — evaluated independently for each system in `systems`
      # All system-specific outputs (packages, devShells, checks, apps) go here.
      # ────────────────────────────────────────────────────────────────────────
      perSystem = { config, pkgs, system, ... }: {

        # ── packages ──────────────────────────────────────────────────────────
        # Remove this block entirely if this flake is devShell-only.
        packages = {
          default = pkgs.stdenv.mkDerivation {
            pname   = "REPLACE_ME";         # package name, no spaces
            version = "0.1.0";

            # $src is a copy of THIS directory: its files land at the top of the
            # unpacked build dir, not under a subdirectory named after it.
            src = ./.;

            # Build-time dependencies (available during build, not at runtime):
            nativeBuildInputs = [
              # pkgs.cmake           # verify: nix {"action":"search","query":"cmake"}
              # pkgs.pkg-config      # verify: nix {"action":"search","query":"pkg-config"}
            ];

            # Runtime dependencies (linked into the output, available at runtime):
            buildInputs = [
              # pkgs.libssl          # verify: nix {"action":"search","query":"openssl"}
            ];

            buildPhase   = "make";
            installPhase = "make install PREFIX=$out";
          };
        };

        # ── devShells ─────────────────────────────────────────────────────────
        devShells = {
          default = pkgs.mkShell {
            # Packages available on PATH inside `nix develop`:
            packages = [
              # VERIFY ALL ATTRIBUTE PATHS via nixos-tools `nix {"action":"search","query":"<name>"}` before adding.
              # pkgs.git
              # pkgs.curl
              # pkgs.gnumake
            ];

            # Inherit buildInputs from the main package (avoids duplication):
            # inputsFrom = [ config.packages.default ];

            shellHook = ''
              echo "Entered ${config.packages.default.pname or "dev"} shell"
              # Additional shell initialization here
            '';
          };
        };

        # ── checks ────────────────────────────────────────────────────────────
        # Derivations here are built by `nix flake check`.
        checks = {
          # format = pkgs.runCommand "check-format" {} ''
          #   ${pkgs.nixfmt-rfc-style}/bin/nixfmt --check ${./.}
          #   touch $out
          # '';
        };

        # ── formatter ─────────────────────────────────────────────────────────
        # Used by `nix fmt`. Pick one and remove the other.
        formatter = pkgs.nixfmt-rfc-style;
        # formatter = pkgs.alejandra;
      };

      # ────────────────────────────────────────────────────────────────────────
      # flake — non-system-scoped outputs (modules, overlays, lib, templates)
      # Leave this block empty or remove it if producing only packages/devShells.
      # ────────────────────────────────────────────────────────────────────────
      flake = {
        # nixosModules.default = ./modules;
        # overlays.default     = final: prev: {};
        # lib                  = import ./lib;
      };
    };
}
