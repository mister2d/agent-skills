# Nix CLI Workflows

> Source: Nix Reference Manual — https://nixos.org/manual/nix/stable/command-ref/new-cli/nix3-flake.html
> Zero to Nix — https://zero-to-nix.com
> Maps traditional workflows to flake-compatible nix CLI commands.

---

## Table of Contents

1. [Core Flake Commands](#core-flake-commands)
2. [NixOS Commands](#nixos-commands)
3. [Home Manager Commands](#home-manager-commands)
4. [Garbage Collection](#garbage-collection)
5. [Package Management (Without NixOS / Profiles)](#package-management-without-nixos--profiles)
6. [Debugging and Introspection](#debugging-and-introspection)
7. [Migration Command Map](#migration-command-map)
8. [Formatting](#formatting)
9. [Useful Flags](#useful-flags)

For symptom-driven diagnosis rather than command reference, see `troubleshooting.md`.

---

## Core Flake Commands

### Inspection

```bash
# Show all outputs defined by a flake
nix flake show

# Show metadata: inputs, source, description, last modified
nix flake metadata

# Show raw evaluated outputs (useful for debugging)
nix eval .#<output-path>

# List all packages in nixpkgs (heavy — use sparingly)
nix search nixpkgs <term>
```

### Validation

```bash
# Evaluate all checks and verify schema — run this before every commit
nix flake check

# Evaluate without building (fast schema/syntax gate)
nix flake check --no-build

# Show what would be built without building
nix build .#default --dry-run
```

### Building

```bash
# Build the default package (outputs.packages.<system>.default)
nix build

# Build a named package
nix build .#<package-name>

# Build for a specific system (cross-compilation context)
nix build .#packages.aarch64-linux.default

# Build and keep result — result symlink appears in CWD
nix build .#default

# Build without creating a result symlink
nix build .#default --no-link

# Build and show output path
nix build .#default --print-out-paths
```

### Running

```bash
# Run the default app (outputs.apps.<system>.default)
nix run

# Run a named app
nix run .#<app-name>

# Run a flake's app from a remote repo without installing
nix run github:nixos/nixpkgs#hello

# Run with arguments passed to the program
nix run .#my-tool -- --verbose --config ./config.toml
```

### Development Shells

```bash
# Enter the default devShell (outputs.devShells.<system>.default)
nix develop

# Enter a named devShell
nix develop .#<shell-name>

# Run a command inside the devShell without entering it
nix develop -c make build

# Merge current environment into the devShell (default: pure shell)
nix develop --keep-going

# Open devShell in a specific directory
nix develop /path/to/flake#<shell-name>
```

### Lock File Management

```bash
# Update all inputs to latest (creates or updates flake.lock)
nix flake update

# Update a single input
nix flake lock --update-input nixpkgs

# Update multiple specific inputs
nix flake lock --update-input nixpkgs --update-input home-manager

# Pin to a specific commit
nix flake lock --override-input nixpkgs "github:NixOS/nixpkgs/<commit-sha>"

# Show the lock file contents
cat flake.lock | nix run nixpkgs#jq -- .nodes.nixpkgs.locked
```

### Initialization

```bash
# Initialize an empty flake in the current directory
nix flake init

# Initialize from a named template
nix flake init -t templates#<name>

# Initialize from a flake's own template output
nix flake init -t github:owner/repo#my-template

# Copy a template from a remote flake
nix flake new -t github:nix-community/templates#python ./my-project
```

---

## NixOS Commands

```bash
# Rebuild and switch to new configuration (requires root)
nixos-rebuild switch --flake .#<hostname>

# Test new configuration (doesn't set as default boot entry)
nixos-rebuild test --flake .#<hostname>

# Build without activating (verify it builds)
nixos-rebuild build --flake .#<hostname>

# Roll back to previous generation
nixos-rebuild switch --rollback

# Use a remote flake (CI deployment)
nixos-rebuild switch --flake github:owner/repo#hostname
```

---

## Home Manager Commands

```bash
# Apply home-manager configuration (standalone mode)
home-manager switch --flake .#<username>@<hostname>

# Or with just the config name as defined in homeConfigurations:
home-manager switch --flake .#alice

# Build without activating
home-manager build --flake .#alice

# List generations
home-manager generations
```

---

## Garbage Collection

```bash
# Remove all generations older than 7 days
nix-collect-garbage --delete-older-than 7d

# Remove all old generations (keep only current)
nix-collect-garbage -d

# As root — also removes NixOS system generations
sudo nix-collect-garbage -d
sudo nixos-rebuild boot  # ensure current generation is the boot default after GC

# Check store size before and after
nix path-info --all | wc -l
du -sh /nix/store
```

---

## Package Management (Without NixOS / Profiles)

```bash
# Install a package to user profile
nix profile install nixpkgs#hello

# Remove a package from user profile
nix profile remove hello

# List installed packages
nix profile list

# Upgrade all profile packages
nix profile upgrade '.*'

# Install from a local flake
nix profile install .#my-tool
```

---

## Debugging and Introspection

```bash
# Open a REPL with nixpkgs in scope
nix repl '<nixpkgs>'          # legacy NIX_PATH style
nix repl .                     # flake REPL (loads outputs into scope)

# In the REPL:
# :l <nixpkgs>                   — load nixpkgs
# pkgs.hello.meta.description    — inspect derivation metadata
# :b pkgs.hello                  — build a derivation from REPL

# Show the closure (all dependencies) of a derivation
nix path-info -r .#default

# Show the size of a derivation's closure
nix path-info -rS .#default | sort -k2 -n | tail -20

# Show why a package is in the closure (bloat debugging)
nix why-depends .#default .#some-dep
```

---

## Migration Command Map

For users coming from traditional package managers:

| Traditional Command | Nix Equivalent |
|---|---|
| `apt install foo` | `nix profile install nixpkgs#foo` |
| `apt-get upgrade` | `nix profile upgrade '.*'` |
| `docker run img cmd` | `nix run github:owner/repo#cmd` |
| `make` | `nix develop -c make` |
| `./configure && make` | Wrap in `mkDerivation` with `buildPhase` |
| `pip install -r requirements.txt` | Add to `devShell` with `python3.withPackages` |
| `brew install foo` | `nix profile install nixpkgs#foo` |
| `which foo` | `nix run nixpkgs#which -- foo` |

---

## Formatting

```bash
# Format all Nix files using the configured formatter
nix fmt

# Check formatting without modifying (CI gate)
nix fmt -- --check .
```

Popular formatters: `nixfmt-rfc-style` (nixfmt v2, RFC 166 compliant), `alejandra`.
Set in `outputs.formatter.<system>` in the flake.

---

## Useful Flags

| Flag | Meaning |
|---|---|
| `--show-trace` | Show full evaluation trace on error — **always add when debugging** |
| `--impure` | Allow impure evaluation (env vars, paths). Never in CI. |
| `--keep-failed` | Keep build directory on failure for inspection |
| `--log-format bar` | Show a progress bar instead of raw logs |
| `-L` / `--print-build-logs` | Print full build output to stdout |
| `--cores 4` | Limit parallel build jobs |
| `--max-jobs 2` | Limit concurrent Nix builds (different from `--cores`) |
| `--no-link` | Do not create a `result` symlink after build |
| `--print-out-paths` | Print the /nix/store output path after build |
