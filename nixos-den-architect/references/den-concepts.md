# Den Core Concepts & API Reference
# vic/den v0.13.0 — March 2026

## Architecture Overview

Den operates as a typed context pipeline layered between flake inputs and flake outputs.
No manual wiring of `nixosConfigurations` or `homeConfigurations` is required — Den
generates them from `den.hosts.*` and `den.homes.*` declarations.

```
flake.nix (inputs only)
    ↓
flake-parts modules (den.hosts / den.homes / den.aspects declared here)
    ↓
Den Schema Layer       — validates den.hosts / den.homes declarations
    ↓
Context Pipeline       — transforms {host} → {host,user} → {home}
    ↓
Aspect Resolution      — parametric dispatch per class via __functor
    ↓
Class Extraction       — isolates nixos / darwin / homeManager keys
    ↓
Output Generation      — nixosConfigurations / darwinConfigurations / homeConfigurations
```

---

## Primary API Surface

### `den.hosts.<s>.<n>`
Declares a NixOS or nix-darwin host.

```nix
den.hosts.x86_64-linux.myhost = {
  class        = "nixos";               # auto-detected from system string
  aspect       = "myhost";             # which aspect to resolve (defaults to host name)
  instantiate  = lib.nixosSystem;      # evaluation function
  intoAttr     = "nixosConfigurations"; # output attribute key
  roles        = [];
  users        = {};                   # { <name> = { roles=[]; classes=[]; }; }
};
```

### `den.homes.<s>.<n>`
Declares a standalone home-manager configuration.

```nix
# Simple standalone home
den.homes.x86_64-linux.alice = {};

# OS-bound standalone home (v0.13.0) — "user@host" syntax
# Binds to an existing host's config. Automatically sets home.userName.
# Allows rebuilding just the home without rebuilding the full OS closure.
den.homes.x86_64-linux."tux@igloo" = {};
den.hosts.x86_64-linux.igloo.users.tux = {};
```

### `den.aspects.<n>`

```nix
den.aspects.my-feature = {
  nixos        = { pkgs, lib, config, ... }: { };
  darwin       = { pkgs, lib, config, ... }: { };
  os           = { pkgs, ... }: { };   # both nixos and darwin
  homeManager  = { pkgs, lib, config, ... }: { };
  hjem         = { };
  user         = { pkgs, osConfig, ... }: { };  # → users.users.<n>

  includes     = [ den.aspects.dep-a ];
  provides     = { sub = den.aspects.sub-aspect; };

  # Custom class keys (roles, alias classes, etc.)
  my-role      = { ... }: { };
};
```

### `den.schema` (was `den.base` pre-v0.12.0)

Typed base modules applied to every entity of that type.

```nix
# Applied to every user across all hosts
den.schema.user = { user, lib, ... }: {
  options.mainGroup = lib.mkOption { default = user.userName; };
  config.classes    = lib.mkDefault [ "homeManager" ];
};

# v0.13.0: user base modules can access their host
den.schema.user = { host, user, lib, ... }: {
  # host is now available in user schema modules
};
```

---

## Context System

### Context types

| Context | Shape | When active |
|---|---|---|
| `host` | `{ host }` | System-level evaluation |
| `user` | `{ host, user }` | Per-user evaluation on a host |
| `home` | `{ home }` | Standalone HM evaluation |
| `hm-host` | derived | HM-as-nixos-module on a host |
| `hm-user` | derived | HM per-user within a host |
| `wsl-host` | derived | WSL-specific host context |

### Parametric resolution

Aspect class values can be a static attrset or a function. Functions are called only
when the context satisfies their argument requirements:

```nix
# Static: always applied
nixos = { environment.systemPackages = [ pkgs.git ]; };

# Parametric: only fires when both host and user are in context
homeManager = { host, user }: {
  home.sessionVariables.HOST = host.name;
};
```

Matching modes via `den.lib.canTake`:
- **`atLeast`** (default): fires if context has at least the required keys
- **`exactly`**: fires only if context has exactly the required keys
- **`only`**: fires only if context has only those keys and no others

**v0.12.0:** All aspects without an explicit `__functor` are `parametric {}` by default,
meaning includes propagate context automatically. Previously you had to wrap with
`parametric { includes = [...]; }`.

---

## `den._.forward` — Custom Class Forwarding

```nix
den._.forward {
  each       = <list>;
  fromClass  = elem: <string>;
  intoClass  = elem: <string>;
  intoPath   = elem: <list>;    # v0.13.0: [] is valid (forwards into module root)
  fromAspect = elem: <aspect>;
  guard      = { options, config, ... }: <bool>;   # optional
  adaptArgs  = { config, ... }: <attrs>;            # v0.13.0: remap args before forwarding
}
```

### Root forwarding with adaptArgs (v0.13.0)

`intoPath = _: []` now works, enabling alias-style classes that target the module root
directly. Combined with `adaptArgs`, this supports platform-conditional HM subclasses:

```nix
# hmLinux / hmDarwin alias classes → homeManager, gated by platform
den._.forward {
  each       = [ "Linux" "Darwin" ];
  fromClass  = p: "hm${p}";
  intoClass  = _: "homeManager";
  intoPath   = _: [];
  fromAspect = _: lib.head aspect-chain;
  guard      = { pkgs, ... }: p: lib.mkIf pkgs.stdenv."is${p}";
  adaptArgs  = { config, ... }: { osConfig = config; };
}
```

---

## Mutual Routing — host ↔ user (v0.13.0)

**`den._.bidirectional` has been removed.** The replacement is `den._.mutual-provider`,
which must be explicitly opted into. This eliminates a class of duplicate-value bugs
that occurred because bidirectional caused host aspects to evaluate in both the host
context and each user context.

```nix
# Opt in
den.ctx.user.includes = [ den._.mutual-provider ];

# Host contributes to all its users
den.aspects.my-host = {
  provides.to-users.my-hm-defaults = den.aspects.my-hm-defaults;
};

# User contributes to all its hosts
den.aspects.my-user = {
  provides.to-hosts.my-sys-config = den.aspects.my-sys-config;
};

# Specific peer routing (still supported)
den.aspects.my-user.provides.my-host = den.aspects.host-specific-config;
den.aspects.my-host.provides.my-user = den.aspects.user-specific-config;
```

---

## `den.ctx` — Context Pipeline

### Extending the pipeline

```nix
den.ctx.host.includes = [ myCustomStage ];
den.ctx.user.includes = [ den._.mutual-provider ];  # opt-in host↔user routing
```

### Built-in context transitions

```nix
den.ctx.host     # {host} → system-level config
den.ctx.user     # {host} → {host,user} per declared user
den.ctx.home     # {home} → standalone HM config
den.ctx.hm-host  # {host} → HM-as-nixos-module
den.ctx.hm-user  # {host,user} → HM per-user
den.ctx.wsl-host # WSL-specific host context
```

---

## `den.lib` — Utility Functions

| Function | Signature | Purpose |
|---|---|---|
| `den.lib.parametric` | `ctx → fn → result` | Apply function when context matches |
| `den.lib.canTake` | `mode → ctx → fn → bool` | Check if fn can take context |
| `den.lib.take` | `ctx → fn → args` | Extract matched args from context |
| `den.lib.owned` | `namespace → name → bool` | Namespace ownership check |
| `den.lib.statics` | `value → value` | Wrap static (non-parametric) value |
| `den.lib.mkFlake` | `{ inputs, src }` | Minimal non-flake-parts entry point |
| `den.lib.perHost` | `fn-or-attrs` | **v0.13.0** Scoped include for `{host}` context |
| `den.lib.perUser` | `fn-or-attrs` | **v0.13.0** Scoped include for `{host, user}` context |
| `den.lib.perHome` | `fn-or-attrs` | **v0.13.0** Scoped include for `{home}` context |

### Context helpers — prefer over `take.exactly` (v0.13.0)

`perHost`, `perUser`, `perHome` are the idiomatic replacement for
`den.lib.take.exactly { ... }` patterns. They accept plain attrsets or functions:

```nix
# Old style (still valid)
den.ctx.host.includes = [
  (den.lib.take.exactly { host } ({ host }: { nixos.networking.hostName = host.name; }))
];

# v0.13.0 preferred
den.ctx.host.includes = [
  (den.lib.perHost ({ host }: { nixos.networking.hostName = host.name; }))
  (den.lib.perHost { nixos.networking.firewall.enable = true; })
];

den.ctx.user.includes = [
  (den.lib.perUser ({ host, user }: { homeManager.home.username = user.userName; }))
];
```

---

## `den.provides` — Built-in Batteries

```nix
den.provides.hostname           # networking.hostName = <host-key>
den.provides.primary-user       # system-level primary user account
den.provides.tty-autologin      # getty@tty1 auto-login
(den.provides.user-shell "fish") # shell enabled system-wide + user default
(den.provides.user-shell "bash")
(den.provides.user-shell "zsh")
den._.mutual-provider           # v0.13.0: opt-in host↔user mutual routing
den._.import-tree               # imports _nixos/ _darwin/ _homeManager/ subdirs
```

---

## Class Key Reference

| Key | Context | Maps to |
|---|---|---|
| `nixos` | host (linux) | NixOS module |
| `darwin` | host (darwin) | nix-darwin module |
| `os` | host (either) | Both nixos and darwin |
| `homeManager` | user / home | home-manager module |
| `hjem` | user / home | hjem home environment |
| `user` | user context | `users.users.<userName>` in OS |
| `microvm` | host | MicroVM guest options |
| `maid` | user | nix-maid dotfiles |
| `persys` | host | Persistence paths (impermanence) |
| `hmLinux`/`hmDarwin` | user | v0.13.0 platform alias via `intoPath=[]` |
| custom | any | Defined by `den._.forward` |

---

## Home Environment Activation

Home environments are opt-in via `user.classes`. No `den.provides.home-manager` import needed.

```nix
# Per-user
den.hosts.x86_64-linux.igloo.users.tux.classes = [ "homeManager" ];

# Fleet default via schema
den.schema.user = { lib, ... }: {
  config.classes = lib.mkDefault [ "homeManager" ];
};

# Multiple home environments per user
den.hosts.x86_64-linux.igloo.users.tux.classes = [ "homeManager" "hjem" ];
```

---

## Import-tree Conventions

- All `.nix` files under `modules/` are loaded as flake-parts modules
- Files/directories prefixed with `_` are skipped (use for phase migration quarantine)
- `default.nix` in a directory is the directory's module
- `den._.import-tree` loads `_nixos/`, `_darwin/`, `_homeManager/` subdirs by class

---

## Known Limitations and Gotchas

| Issue | Mitigation |
|---|---|
| `specialArgs` unsupported | Use `let` bindings or flake-parts options |
| `den._.bidirectional` removed (v0.13.0) | Migrate to `den._.mutual-provider` |
| `den.base` renamed to `den.schema` (v0.12.0) | Use `den.schema.*` throughout |
| Circular `includes` → infinite recursion | Keep DAG acyclic; extract shared aspects |
| home-manager requires explicit flake input | Add `home-manager.url` + nixpkgs follows |
| Darwin requires nix-darwin flake input | Add `nix-darwin.url` for macOS hosts |
| `_`-prefixed files silently skipped | Expected behavior; document intentionally |
| Framework primarily by one developer | Pin to release tag in production |

---

## Project Initialization Commands

```bash
nix flake init -t github:vic/den            # default (flake-parts + home-manager)
nix flake init -t github:vic/den#minimal    # no flake-parts, no home-manager
nix flake init -t github:vic/den#noflake    # no flakes (npins + lib.evalModules)
nix flake init -t github:vic/den#microvm    # MicroVM support
nix run github:vic/den                      # quick QEMU VM test
```

---

## Version Pinning

```nix
den.url = "github:vic/den/v0.13.0";
den.inputs.nixpkgs.follows = "nixpkgs";
```

Latest stable: **v0.13.0** (March 19, 2026). 227 stars, 21 forks, 14 contributors.
https://github.com/vic/den/releases
