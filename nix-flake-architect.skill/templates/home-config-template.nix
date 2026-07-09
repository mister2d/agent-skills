# Template: Home Manager — Standalone Configuration
#
# Use case: Managing user environment independently of NixOS system config,
#           or for non-NixOS systems (Ubuntu, macOS via nix-darwin companion).
# Activation: `home-manager switch --flake .#USERNAME`
#
# Query nixos-tools `home_manager_options_search` before writing any programs.* block.
# Query nixos-tools `darwin_options_search` if target is macOS.
#
{
  description = "REPLACE_ME: Home Manager configuration for USERNAME";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs"; # REQUIRED
    };
  };

  outputs = { self, nixpkgs, home-manager, ... }:
    let
      # Adjust as needed. For multi-system, use flake-parts instead.
      system = "x86_64-linux"; # or "aarch64-darwin" for Apple Silicon
      pkgs   = nixpkgs.legacyPackages.${system};
    in {
      # Key format: homeConfigurations."username" or "username@hostname"
      homeConfigurations."REPLACE_USERNAME" = home-manager.lib.homeManagerConfiguration {
        inherit pkgs;

        # Extra arguments passed to all home modules
        extraSpecialArgs = { inherit self; };

        modules = [
          ./home.nix    # primary home configuration module

          # Inline overrides (or remove and put everything in home.nix):
          {
            # Required: home.username and home.homeDirectory must be set.
            home.username      = "REPLACE_USERNAME";
            home.homeDirectory = "/home/REPLACE_USERNAME"; # macOS: /Users/USERNAME

            # Required: match the home-manager release you are using.
            # Verify current version via nixos-tools flakehub_search "home-manager"
            home.stateVersion = "24.11";
          }
        ];
      };
    };
}

# ──────────────────────────────────────────────────────────────────────────────
# Companion: home.nix — primary home configuration module
# Save this as ./home.nix alongside flake.nix
# ──────────────────────────────────────────────────────────────────────────────
#
# { config, pkgs, lib, ... }:
# {
#   # ── User Packages ──────────────────────────────────────────────────────────
#   # Verify all attribute paths via nixos-tools `nixpkgs_search`
#   home.packages = [
#     pkgs.htop
#     pkgs.ripgrep
#     pkgs.fd
#   ];
#
#   # ── Program Modules ────────────────────────────────────────────────────────
#   # Query nixos-tools `home_manager_options_search "programs.git"` before editing
#   programs.git = {
#     enable    = true;
#     userName  = "REPLACE_ME";
#     userEmail = "REPLACE_ME@example.com";
#     extraConfig = {
#       init.defaultBranch  = "main";
#       pull.rebase         = true;
#     };
#   };
#
#   programs.bash = {
#     enable      = true;
#     shellAliases = {
#       ll = "ls -la";
#       gs = "git status";
#     };
#   };
#
#   programs.zsh = {
#     enable              = true;
#     autosuggestion.enable = true;
#     syntaxHighlighting.enable = true;
#   };
#
#   # ── Dotfile Management ─────────────────────────────────────────────────────
#   home.file.".config/my-app/config.toml".text = ''
#     [settings]
#     theme = "dark"
#   '';
#
#   # ── XDG Config Files ───────────────────────────────────────────────────────
#   xdg.configFile."my-tool/config.yaml".source = ./config/my-tool.yaml;
#
#   # ── Session Variables ──────────────────────────────────────────────────────
#   home.sessionVariables = {
#     EDITOR = "nvim";
#     PAGER  = "less";
#   };
#
#   # ── User Services ──────────────────────────────────────────────────────────
#   # Query: home_manager_options_search "services.syncthing"
#   services.syncthing.enable = true;
#
#   # ── Required state version ─────────────────────────────────────────────────
#   home.stateVersion = "24.11";
# }
