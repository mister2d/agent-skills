# Phase Migration Procedures
# Step-by-step operational guide for nix-nexus → Den migration
# Updated for Den v0.13.0

## Pre-Migration Audit Checklist

Before generating any code, answer each question by reading the user's codebase:

```
[ ] How many hosts are declared in flake.nix?
[ ] How many users per host?
[ ] Is home-manager a NixOS module or standalone?
[ ] Are there specialArgs in nixosSystem / homeManagerConfiguration calls?
[ ] Count .nix files in: hosts/ profiles/ modules/
[ ] Any non-standard flake inputs? (disko, impermanence, sops-nix, etc.)
[ ] Is there a hardware-configuration.nix per host?
[ ] Any overlays or lib extensions?
[ ] Is nixpkgs pinned? Which channel?
[ ] Any existing flake-parts usage?
[ ] Any den._.bidirectional usage? (removed in v0.13.0 — must migrate to mutual-provider)
[ ] Any den.base.* usage? (renamed to den.schema.* in v0.12.0)
```

Produce a concise report:
```
AUDIT REPORT
============
Hosts        : <n> (systems: <list>)
Users        : <n> total across all hosts
HM mode      : nixos-module | standalone
specialArgs  : yes (keys: ...) | no
Module count : hosts/<n>, profiles/<n>, modules/<n>
Non-std inputs: <list>
Hardware configs: yes | no
Estimated phase: 1
Migration risk: low | medium | high
```

---

## Phase 2 — Pipeline Bootstrapping

### Step 1: Add Den to flake.nix

```nix
# In flake.nix inputs:
den.url = "github:vic/den";
den.inputs.nixpkgs.follows = "nixpkgs";
# If not already present, also add:
flake-parts.url = "github:hercules-ci/flake-parts";
```

Run:
```bash
nix flake update den
nix flake update flake-parts
```

### Step 2: Rewrite flake.nix outputs section

Replace the `outputs = { self, nixpkgs, ... }:` block with the Den/flake-parts hybrid. See `den-boilerplate.md#flake-bootstrap` for the Phase 2 hybrid template.

The old `nixosConfigurations` and `homeConfigurations` blocks are **deleted**. Den generates them automatically from `den.hosts.*` declarations.

### Step 3: Create modules/ directory and hosts.nix

```bash
mkdir -p modules
```

Create `modules/hosts.nix` declaring all hosts. See `den-boilerplate.md#host-and-home-declarations`. Use the legacy-compat wrapper pattern from `den-boilerplate.md#legacy-compat` to wrap existing imports.

### Step 4: Validate

```bash
nix flake check
# Verify outputs are present:
nix eval .#nixosConfigurations --apply builtins.attrNames
# Test a build:
nix build .#nixosConfigurations.sweet16.config.system.build.toplevel --dry-run
```

**Phase 2 success criteria:** `nix build` succeeds using the legacy wrapper. No functional change to the running system. Old module files are untouched.

---

## Phase 3 — Aspect Extraction

### Conversion priority order

Convert modules in this order to minimize breakage:

1. **Hardware profiles** (`profiles/hardware/`) — pure `nixos` key, no HM concerns, low risk.
2. **Core system modules** (`modules/core/`) — `nixos` key only if system-only, otherwise `nixos` + `homeManager`.
3. **Desktop/application modules** (`modules/desktop/`) — highest yield from unification; combine `sway.nix` + `sway-home.nix` into one aspect.
4. **User modules** (`modules/user/`) — fold into user aspect `homeManager` key.
5. **Host definitions** (`hosts/*/default.nix` + `hosts/*/home.nix`) — convert last, after all feature aspects exist.

### Per-module conversion procedure

For each legacy module:

**1. Identify concerns:**
```bash
grep -n "services\.\|boot\.\|hardware\.\|networking\." modules/core/zfs.nix   # system concerns
grep -n "programs\.\|home\.\|xdg\.\|wayland\."         modules/core/zfs.nix   # user concerns
```

**2. Create new aspect file:**
```bash
# New: modules/zfs.nix (replaces modules/core/zfs.nix)
```

**3. Disable the old file:**
```bash
mv modules/core/zfs.nix modules/core/_zfs.nix   # import-tree skips _-prefixed
```

**4. Remove old import from legacy wrapper** in `modules/_compat.nix`.

**5. Add new aspect to host's `includes`** in the host aspect.

**6. Validate:**
```bash
nix build .#nixosConfigurations.<host>.config.system.build.toplevel --dry-run
```

### Eliminating specialArgs

`specialArgs` is Den's primary anti-pattern. Replace each pattern:

**Pattern A: passing `inputs` to modules**
```nix
# BEFORE (flake.nix)
specialArgs = { inherit inputs; };
# Module: { inputs, ... }: { imports = [ inputs.disko.nixosModules.disko ]; }

# AFTER (aspect)
# inputs is already available in the flake-parts module scope
{ den, inputs, ... }: {
  den.aspects.disko = {
    nixos = { ... }: { imports = [ inputs.disko.nixosModules.disko ]; };
  };
}
```

**Pattern B: passing custom lib or functions**
```nix
# BEFORE
specialArgs = { myLib = import ./lib.nix { inherit lib; }; };

# AFTER: declare in flake-parts perSystem or as a top-level let
# modules/_lib.nix
{ config, lib, ... }: {
  options.myFlake.lib = lib.mkOption { type = lib.types.attrs; };
  config.myFlake.lib  = import ../lib.nix { inherit lib; };
}
# Then consume: { config, ... }: { /* use config.myFlake.lib */ }
```

**Pattern C: passing hostname/system**
```nix
# BEFORE
specialArgs = { hostname = "sweet16"; system = "x86_64-linux"; };

# AFTER: use den.provides.hostname battery + built-in host context
den.hosts.x86_64-linux.sweet16.users.ddukes = {};
# Den resolves hostname from the key. No specialArgs needed.
```

### specialArgs elimination checklist
```
[ ] All inputs.* references moved into aspect files (inputs available in scope)
[ ] hostname/system derived from Den context (den.provides.hostname)
[ ] Custom lib moved to flake-parts option or let binding
[ ] Any remaining specialArgs documented as exceptions with justification
```

### Migrate bidirectional → mutual-provider (v0.13.0 breaking change)

`den._.bidirectional` has been **removed** in v0.13.0. If present in the codebase, the
build will fail with an unknown attribute error.

**Detect:**
```bash
grep -r "bidirectional" modules/
```

**Migrate — three steps:**

**Step 1:** Create `modules/_classes/mutual.nix` to opt in:
```nix
{ den, ... }: {
  den.ctx.user.includes = [ den._.mutual-provider ];
}
```

**Step 2:** For every host aspect that had `homeManager` keys intended for users,
move that config to a dedicated aspect and expose it via `provides.to-users`:
```nix
# BEFORE (v0.12.0 — bidirectional let host push homeManager to users)
den.aspects.sweet16.homeManager = { ... }: { home.stateVersion = "24.05"; };

# AFTER (v0.13.0 — explicit routing)
# modules/sweet16-hm-defaults.nix
den.aspects.sweet16-hm-defaults.homeManager = { ... }: { home.stateVersion = "24.05"; };

# modules/sweet16.nix — declare the route
den.aspects.sweet16.provides.to-users.hm-defaults = den.aspects.sweet16-hm-defaults;
```

**Step 3:** For every user aspect that had `nixos` keys intended for hosts,
move that config to a dedicated aspect and expose it via `provides.to-hosts`:
```nix
# BEFORE (v0.12.0 — bidirectional let user push nixos config to hosts)
den.aspects.ddukes.nixos = { ... }: { programs.fish.enable = true; };

# AFTER (v0.13.0)
# modules/ddukes-sys.nix
den.aspects.ddukes-sys.nixos = { ... }: { programs.fish.enable = true; };

# modules/ddukes.nix
den.aspects.ddukes.provides.to-hosts.sys = den.aspects.ddukes-sys;
```

### Activate home environments per-user (v0.11.0+ — replaces den.provides.home-manager)

Home environments are no longer activated by importing `den.provides.home-manager`.
They are activated by declaring `user.classes`. Set a fleet-wide default in schema:

```nix
# modules/schema.nix — applies to all users
{ den, lib, ... }: {
  den.schema.user = { lib, ... }: {
    config.classes = lib.mkDefault [ "homeManager" ];
  };
}
```

Or per-host per-user:
```nix
den.hosts.x86_64-linux.sweet16.users.ddukes.classes = [ "homeManager" ];
```

**Phase 3 success criteria:** Zero `specialArgs` in any evaluation call. Each feature
lives in exactly one aspect file. No `.nix` file in `modules/core/`, `modules/desktop/`,
`modules/user/` is un-prefixed (not archived or deleted). No `den._.bidirectional` usage
remains. No `den.base.*` usage remains (renamed to `den.schema.*`).

---

## Phase 4 — True Dendritic Architecture

### Converting host files to pure aspect declarations

**Before (Phase 3 — still has host-specific aspects with hardware imports):**
```nix
# modules/sweet16.nix
den.aspects.sweet16 = {
  includes = [ den.provides.hostname den.aspects.zfs ... ];
  nixos = { ... }: { imports = [ ./hardware/sweet16-hardware-configuration.nix ]; };
};
```

**After (Phase 4 — hardware is its own aspect):**
```nix
# modules/hardware/sweet16.nix
den.aspects."hw-sweet16" = {
  nixos = { ... }: {
    imports = [ ./sweet16-hardware-configuration.nix ];
    # All machine-specific hardware config lives here
    boot.loader.systemd-boot.enable = true;
    networking.hostId = "deadbeef";
  };
};

# modules/sweet16.nix — pure dependency declaration
den.aspects.sweet16 = {
  includes = [
    den.provides.hostname
    den.aspects."hw-sweet16"
    den.aspects.zfs
    den.aspects.sway
    den.aspects.ddukes
  ];
};
```

### Dynamic DAG validation

After Phase 4, the dependency graph should be inspectable. Generate a visualization:
```bash
# Check for circular dependencies by evaluating the aspect resolution:
nix eval .#nixosConfigurations.sweet16.config._module.args \
  --apply 'x: builtins.attrNames x' 2>&1 | head -40
```

### Phase 4 checklist
[ ] den.lib.take.exactly patterns replaced with perHost/perUser/perHome (v0.13.0 QOL)
[ ] den._.mutual-provider opted in if any host<->user config routing is active
[ ] OS-bound standalone homes declared as "user@host" where fast HM rebuilds are needed
```

---

## Rollback Procedures

### Rollback Phase 2 → Phase 1
```bash
git checkout flake.nix
git checkout flake.lock
rm -rf modules/_compat.nix modules/hosts.nix
```

### Rollback a single aspect conversion
```bash
# Re-enable the archived legacy module
mv modules/core/_zfs.nix modules/core/zfs.nix
# Re-add import to _compat.nix legacy wrapper
# Remove the new aspect file
rm modules/zfs.nix
```

---

## Common Migration Errors

### Error: `error: attribute 'specialArgs' missing`
The new flake.nix still has a reference to `specialArgs` that was used in an old `nixosSystem` call. Confirm all `nixosSystem`/`homeManagerConfiguration` calls have been removed from flake.nix.

### Error: `infinite recursion encountered`
Usually caused by a circular `includes` chain. Check if two aspects include each other. Resolve by extracting shared config into a third aspect that both include.

### Error: `error: undefined variable 'den'`
The aspect file is not inside the `modules/` directory scanned by `import-tree`, or the flake-parts Den module wasn't imported. Check `imports = [ inputs.den.flakeModules.default ]` in flake.nix.

### Error: `attribute 'nixosConfigurations' missing` after migration
Den generates `nixosConfigurations` automatically from `den.hosts.*`. If empty, check that `modules/hosts.nix` exists and that the host declaration uses the correct system string (`x86_64-linux`, not `x86_64`).

### Error: home-manager options not evaluated
Check that `home-manager.url` is in flake inputs and that `den.inputs.home-manager.follows` or the flake-parts home-manager module is active. Den requires home-manager as a flake input to enable `homeManager` class resolution.

### Warning: `import-tree` ignoring a file
Files prefixed with `_` are intentionally skipped by `import-tree`. If a file is being ignored unexpectedly, check its name. Directories named `_legacy/` are also skipped entirely.

### Error: `error: attribute 'bidirectional' missing` (v0.13.0)
`den._.bidirectional` was removed in v0.13.0. Run `grep -r "bidirectional" modules/` to
locate all usages, then follow the bidirectional → mutual-provider migration procedure
in the Phase 3 section above. The replacement requires an explicit opt-in file and
re-routing `homeManager`/`nixos` cross-domain keys into dedicated aspects.

### Error: duplicate option values after upgrading to v0.13.0
If you were relying on bidirectional behaviour implicitly (host aspects had `homeManager`
keys that were contributing to users), those keys now only fire in the host context and
will either be silently ignored for users or cause duplicates depending on the include
chain. The fix is explicit `provides.to-users.*` routing via `den._.mutual-provider`.

### Error: `error: attribute 'base' missing` when using `den.base.*`
`den.base` was renamed to `den.schema` in v0.12.0. Run `grep -r "den\.base" modules/`
and replace every occurrence with `den.schema`.

### Error: homeManager class not activating after v0.11.0 upgrade
`den.provides.home-manager` is now a no-op that raises an error. Remove it from all
`includes` lists and instead set `user.classes` either per-user or via `den.schema.user`.
