# Template: Overlay Consumer Integration
#
# Use case: Consuming an overlays-only flake as an input in a downstream flake.
# This template demonstrates all three integration modes:
#
#   Mode 1 — Scoped instantiation (preferred, isolated impact)
#   Mode 2 — Global NixOS overlay (system-wide, higher cache invalidation)
#   Mode 3 — Home Manager overlay (user-scope)
#
# Read references/overlays-only-pattern.md §7 for the scoped vs global trade-off.
#
{
  description = "REPLACE_ME: consumer flake that applies an upstream overlay";

  inputs = {
    nixpkgs.url     = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    systems.url     = "github:nix-systems/default";

    # The overlays-only flake being consumed.
    # Verify URL via nixos-tools: flakehub_search "REPLACE_OVERLAY_NAME"
    my-overlay = {
      url = "github:REPLACE_OWNER/REPLACE_OVERLAY_REPO";
      # Pin nixpkgs to prevent duplicate nixpkgs evaluations:
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Optional: home-manager if Mode 3 is needed
    # home-manager = {
    #   url = "github:nix-community/home-manager";
    #   inputs.nixpkgs.follows = "nixpkgs";
    # };
  };

  outputs = inputs @ { flake-parts, nixpkgs, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {

      systems = import inputs.systems;

      perSystem = { system, pkgs, inputs', ... }:
        # ──────────────────────────────────────────────────────────────────────
        # MODE 1: Scoped Instantiation (PREFERRED)
        #
        # Creates a local nixpkgs with the overlay applied.
        # Only packages built from `overlaidPkgs` are affected.
        # The system's global `pkgs` instance is untouched.
        # Binary cache integrity preserved for everything outside this scope.
        # ──────────────────────────────────────────────────────────────────────
        let
          overlaidPkgs = import nixpkgs {
            inherit system;
            config   = {};  # set allowUnfree here if needed
            overlays = [ inputs.my-overlay.overlays.default ];
          };
        in {
          # Build the overlaid package directly:
          packages.my-custom-tool = overlaidPkgs.REPLACE_PACKAGE_FROM_OVERLAY;

          # Develop against the overlaid package set:
          devShells.default = overlaidPkgs.mkShell {
            packages = [
              overlaidPkgs.REPLACE_PACKAGE_FROM_OVERLAY
              pkgs.git  # standard packages still from system pkgs
            ];
          };
        };

      flake = {
        # ──────────────────────────────────────────────────────────────────────
        # MODE 2: Global NixOS Overlay
        #
        # Applies the overlay to the entire nixpkgs instance for the system.
        # Use when the overlaid packages must be consistent system-wide
        # (e.g., patching glibc, replacing openssl for security compliance).
        # Trade-off: higher cache invalidation — the overlaid nixpkgs hash
        # differs from the official cache.nixos.org namespace.
        # ──────────────────────────────────────────────────────────────────────
        nixosConfigurations.REPLACE_HOSTNAME = nixpkgs.lib.nixosSystem {
          modules = [
            # Apply overlay globally to the NixOS pkgs instance:
            { nixpkgs.overlays = [ inputs.my-overlay.overlays.default ]; }

            # If the overlay ships a NixOS module, import it here:
            # inputs.my-overlay.nixosModules.default

            ./hosts/REPLACE_HOSTNAME/configuration.nix
          ];
        };
      };
    };
}

# ──────────────────────────────────────────────────────────────────────────────
# MODE 3: Home Manager Overlay (user-scope)
#
# Apply the overlay only within a user's Home Manager configuration.
# Useful when a package is needed at the user level but not system-wide.
# ──────────────────────────────────────────────────────────────────────────────
#
# In home.nix (or home-manager module):
#
# { config, pkgs, inputs, lib, ... }:
# let
#   overlaidPkgs = import inputs.nixpkgs {
#     inherit (pkgs) system;
#     overlays = [ inputs.my-overlay.overlays.default ];
#   };
# in {
#   home.packages = [
#     overlaidPkgs.REPLACE_PACKAGE_FROM_OVERLAY
#   ];
# }
#
# Alternatively, if using home-manager as a NixOS module with useGlobalPkgs = true,
# apply the overlay in nixpkgs.overlays at the system level (Mode 2) so home-manager
# shares the same pkgs instance.

# ──────────────────────────────────────────────────────────────────────────────
# MODE 4: flake-parts Consumer (if overlay ships a flakeModule)
#
# If the overlay flake exposes flakeModules.default, consume it via imports
# inside your flake-parts mkFlake call. This is NOT standard Nix CLI output;
# it is a flake-parts convention only.
# ──────────────────────────────────────────────────────────────────────────────
#
# flake-parts.lib.mkFlake { inherit inputs; } {
#   imports = [
#     inputs.my-overlay.flakeModules.default  # opt-in to overlay's perSystem extensions
#   ];
#   ...
# }
