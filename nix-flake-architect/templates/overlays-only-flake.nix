# Template: Overlays-Only / Library Distribution Flake
#
# Use case: Distributing nixpkgs extensions as a flake input consumed by downstream flakes.
# Framework: flake-parts (non-system overlay outputs; per-system checks and dev tooling)
#
# TRADE-OFF ACKNOWLEDGMENT: This template intentionally omits packages.*, apps.*, and
# devShells.* from the public API. The following CLI commands will NOT work against this
# flake directly:
#
#   nix build .#<package>       ← no packages.* output (use checks.* for testing)
#   nix run .#<app>             ← no apps.* output (consumers run from their own flake)
#   nix profile install .#<x>  ← no packages.* output
#
# These are intentional trade-offs. See references/overlays-only-pattern.md for rationale
# and consumer integration guidance.
#
# BEFORE USING THIS TEMPLATE:
#   1. Verify nixpkgs channel and package attribute paths via nixos-tools
#   2. Read references/overlays-only-pattern.md §5 (fixed-point law) and §6 (anti-patterns)
#   3. Confirm the git staging rule: `git add` all new files before `nix flake check`
#
{
  description = "REPLACE_ME: nixpkgs overlay providing custom packages";

  # ──────────────────────────────────────────────────────────────────────────────
  # Inputs
  # ──────────────────────────────────────────────────────────────────────────────
  inputs = {
    nixpkgs.url     = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    systems.url     = "github:nix-systems/default";
  };

  # ──────────────────────────────────────────────────────────────────────────────
  # Outputs
  # ──────────────────────────────────────────────────────────────────────────────
  outputs = inputs @ { flake-parts, nixpkgs, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {

      systems = import inputs.systems;

      # ────────────────────────────────────────────────────────────────────────
      # perSystem — internal tooling only; NOT the public distribution API
      # ────────────────────────────────────────────────────────────────────────
      perSystem = { system, pkgs, ... }:
        let
          # Instantiate a SCOPED overlay nixpkgs for testing.
          # Scoped = does not affect the global pkgs instance.
          # This is exactly what consumers will do; it validates the consumer path.
          overlaidPkgs = import nixpkgs {
            inherit system;
            overlays = [ inputs.self.overlays.default ];
          };
        in {

          # ── Smoke-Test Checks ───────────────────────────────────────────────
          # These run under `nix flake check` and are the primary correctness gate.
          # List packages that are representative of what the overlay provides.
          # Keep the list small — this is a smoke test, not a full matrix.
          checks = {

            # Does the primary package evaluate and build?
            smoke-primary = overlaidPkgs.REPLACE_PACKAGE_NAME;
            # verify attr path: nixos-tools nix {"action":"search","query":"REPLACE_PACKAGE_NAME"}

            # Does core nixpkgs still evaluate correctly after the overlay?
            # Detects broken recursive set merges (see references/overlays-only-pattern.md §6)
            nixpkgs-integrity = overlaidPkgs.hello;

            # Optional: functional test — install and run the package
            # smoke-install = overlaidPkgs.runCommand "smoke-install" {
            #   nativeBuildInputs = [ overlaidPkgs.REPLACE_PACKAGE_NAME ];
            # } ''
            #   REPLACE_PACKAGE_NAME --version > $out
            # '';
          };

          # ── Internal Developer Shell ────────────────────────────────────────
          # For contributors working ON the overlay. Not a consumer-facing API.
          # Accessible via `nix develop`.
          devShells.default = pkgs.mkShell {
            packages = [
              pkgs.nixfmt-rfc-style   # nix fmt
              pkgs.nix-prefetch-git   # fetch new package sources
              pkgs.cacert             # HTTPS for nix-prefetch operations
              pkgs.git
            ];
            shellHook = ''
              echo "nix-flake-overlay dev shell — for overlay contributors"
              echo "Consumers: see README for integration instructions"
            '';
          };

          # ── Formatter ───────────────────────────────────────────────────────
          formatter = pkgs.nixfmt-rfc-style;
        };

      # ────────────────────────────────────────────────────────────────────────
      # flake — the PUBLIC distribution API (non-system-scoped)
      # These are what downstream flakes consume as inputs.
      # ────────────────────────────────────────────────────────────────────────
      flake = {

        # ── Primary Distribution Output ────────────────────────────────────────
        # Consumers apply this overlay to their own nixpkgs instance.
        # See templates/overlay-consumer-integration.nix for integration patterns.
        overlays.default = final: prev: {
          #
          # LAW: Reference all dependencies from `final`, not `prev`.
          # Use `prev` only to access the original version of a package you are
          # overriding, to avoid infinite recursion. See overlays-only-pattern.md §5.
          #

          # ── New packages (additions to nixpkgs) ─────────────────────────────
          # Pattern: callPackage from ./pkgs/<name>/default.nix
          # Verify the attribute name doesn't conflict: nixos-tools nix {"action":"search","query":"name"}
          #
          REPLACE_PACKAGE_NAME = final.callPackage ./pkgs/REPLACE_PACKAGE_NAME {};

          # ── Package overrides (modifying existing nixpkgs packages) ──────────
          # Use overrideAttrs to patch; use prev.<name> to access original.
          #
          # some-existing-package = prev.some-existing-package.overrideAttrs (old: {
          #   patches = (old.patches or []) ++ [ ./patches/fix-something.patch ];
          # });

          # ── Python/Perl/Haskell package sets ─────────────────────────────────
          # DO NOT use: python3Packages = prev.python3Packages // { ... }
          # That pattern breaks downstream overlay composition (see §6).
          # CORRECT pattern:
          #
          # python3 = prev.python3.override {
          #   packageOverrides = pyFinal: pyPrev: {
          #     my-python-lib = pyFinal.callPackage ./pkgs/my-python-lib {};
          #   };
          # };
          # python3Packages = final.python3.pkgs;  # keep in sync at top-level
        };

        # ── NixOS Module (optional) ────────────────────────────────────────────
        # Expose a NixOS module if the packages need system-level configuration.
        # Consumers import this alongside the overlay in their nixosConfiguration.
        # nixosModules.default = ./modules;

        # ── flake-parts Module (optional) ─────────────────────────────────────
        # For consumers using flake-parts: a reusable perSystem module.
        # NOT a standard Nix CLI output — flake-parts consumers only.
        # flakeModules.default = ./flake-modules/integration.nix;

        # ── Pure Library Functions (optional) ─────────────────────────────────
        # Nix helper functions with no derivation evaluation.
        # Consumers access as: inputs.my-overlay.lib.someHelper
        # lib = import ./lib { inherit (nixpkgs) lib; };
      };
    };
}
