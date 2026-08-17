# Template: flake-utils — Minimal (Legacy Compatibility)
#
# Use case: maintaining or reading existing flake-utils-based flakes.
# NEW projects should use flake-parts instead. This template is provided so
# the agent can generate or patch flake-utils flakes when the user already has one.
#
# Key difference from flake-parts:
#   - Functional, not module-based
#   - `eachDefaultSystem` returns a merged attribute set
#   - Non-system outputs are merged with `//`
#
{
  description = "REPLACE_ME: project description";

  inputs = {
    nixpkgs.url     = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    # eachDefaultSystem iterates over:
    # [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ]
    # and merges the returned attribute sets under their respective system keys.
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        # ── Packages ──────────────────────────────────────────────────────────
        packages = {
          default = pkgs.stdenv.mkDerivation {
            pname   = "REPLACE_ME";
            version = "0.1.0";
            src     = ./.;

            nativeBuildInputs = [
              # pkgs.cmake
            ];
            buildInputs = [
              # pkgs.libssl
            ];

            buildPhase   = "make";
            installPhase = "make install PREFIX=$out";
          };
        };

        # ── devShells ─────────────────────────────────────────────────────────
        devShells = {
          default = pkgs.mkShell {
            packages = [
              # Verify all attribute paths via nixos-tools before adding
              # pkgs.git
              # pkgs.gnumake
            ];
            shellHook = ''
              echo "Entered dev shell"
            '';
          };
        };

        # ── Apps ──────────────────────────────────────────────────────────────
        apps = {
          # default = flake-utils.lib.mkApp { drv = self.packages.${system}.default; };
        };

        # ── Formatter ─────────────────────────────────────────────────────────
        formatter = pkgs.nixfmt-rfc-style;
      }
    )
    # Non-system-scoped outputs are merged with `//` outside eachDefaultSystem:
    // {
      nixosModules = {
        # default = ./modules;
      };
      overlays = {
        # default = final: prev: {};
      };
    };
}
