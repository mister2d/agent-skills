# Den Boilerplate Reference
# Validated patterns sourced from vic/den v0.13.0 (March 2026)

## Table of Contents
1. [Flake Bootstrap](#flake-bootstrap)
2. [Host and Home Declarations](#host-and-home-declarations)
3. [Aspect Patterns](#aspect-patterns)
4. [Built-in Provides Batteries](#provides)
5. [Advanced Patterns — Forwarding, Roles, Guards](#advanced-patterns)
6. [Fleet Patterns — HPC and Multi-Host](#fleet-patterns)
7. [Legacy Compatibility Wrapper](#legacy-compat)

---

## flake-bootstrap

### Minimal flake.nix (no flake-parts, no home-manager)
```nix
{
  description = "My NixOS configuration — Den minimal";

  inputs = {
    nixpkgs.url     = "github:NixOS/nixpkgs/nixos-unstable";
    den.url         = "github:vic/den";
    den.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, den, ... }@inputs:
    den.lib.mkFlake {
      inherit inputs;
      # Den discovers all .nix files under ./modules
      src = ./modules;
    };
}
```

### Standard flake.nix (flake-parts + home-manager)
```nix
{
  description = "My NixOS configuration — Den standard";

  inputs = {
    nixpkgs.url          = "github:NixOS/nixpkgs/nixos-unstable";
    home-manager.url     = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
    flake-parts.url      = "github:hercules-ci/flake-parts";
    den.url              = "github:vic/den";
    den.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [ inputs.den.flakeModules.default ];
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      perSystem = { pkgs, ... }: { };
    };
}
```

### Phase 2 hybrid flake.nix (Den + legacy nix-nexus modules)
```nix
{
  description = "nix-nexus → Den migration — Phase 2";

  inputs = {
    nixpkgs.url          = "github:NixOS/nixpkgs/nixos-unstable";
    home-manager.url     = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
    flake-parts.url      = "github:hercules-ci/flake-parts";
    den.url              = "github:vic/den";
    den.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        inputs.den.flakeModules.default
        # Den discovers modules/ automatically
      ];
      systems = [ "x86_64-linux" "aarch64-linux" ];
    };
}
```

---

## host-and-home-declarations

### Single host, single user
```nix
# modules/hosts.nix
{ den, ... }: {
  den.hosts.x86_64-linux.sweet16.users.ddukes = {};
}
```

### Multiple hosts — nix-nexus fleet pattern
```nix
# modules/hosts.nix
{ den, ... }: {
  # Workstation
  den.hosts.x86_64-linux.sweet16.users.ddukes = {};
  # Secondary machine
  den.hosts.x86_64-linux.petunia.users.ddukes = {};
  # Headless server
  den.hosts.x86_64-linux.nexus-srv = {};
  # HPC compute nodes
  den.hosts.x86_64-linux.hpc-node-01 = { roles = [ "compute" ]; };
  den.hosts.x86_64-linux.hpc-node-02 = { roles = [ "compute" ]; };
}
```

### Standalone home-manager (no NixOS host)
```nix
# modules/hosts.nix
{ den, ... }: {
  den.homes.x86_64-linux.ddukes = {};
}
```

### Cross-platform (Linux + macOS)
```nix
# modules/hosts.nix
{ den, ... }: {
  den.hosts.x86_64-linux.workstation.users.ddukes = {};
  den.hosts.aarch64-darwin.macbook.users.ddukes   = {};
}
```

---

## aspect-patterns

### Minimal aspect (system-only feature)
```nix
# modules/zfs.nix
{ den, ... }: {
  den.aspects.zfs = {
    nixos = { ... }: {
      boot.supportedFilesystems = [ "zfs" ];
      boot.zfs.devNodes         = "/dev/disk/by-id";
      services.zfs.autoScrub.enable = true;
      services.zfs.autoSnapshot = {
        enable    = true;
        frequent  = 8;
        hourly    = 24;
        daily     = 7;
        weekly    = 4;
        monthly   = 12;
      };
    };
  };
}
```

### Unified aspect (system + user, replaces sway.nix + sway-home.nix)
```nix
# modules/sway.nix
{ den, pkgs, ... }: {
  den.aspects.sway = {
    includes = [
      den.provides.hostname
    ];

    # System-level: GPU drivers, PAM, display manager
    nixos = { pkgs, ... }: {
      hardware.opengl.enable          = true;
      security.pam.services.swaylock  = {};
      programs.sway.enable            = true;
      programs.sway.wrapperFeatures.gtk = true;
      xdg.portal.wlr.enable           = true;
    };

    # User-level: sway config, waybar, swaylock theme
    homeManager = { pkgs, ... }: {
      wayland.windowManager.sway = {
        enable  = true;
        config  = {
          modifier = "Mod4";
          terminal = "foot";
        };
      };
      programs.waybar.enable      = true;
      services.swayidle.enable    = true;
    };
  };
}
```

### Host aspect (replaces hosts/sweet16/default.nix + home.nix)
```nix
# modules/sweet16.nix
{ den, inputs, ... }: {
  den.aspects.sweet16 = {
    includes = [
      den.provides.hostname
      den.aspects.zfs
      den.aspects.sway
      den.aspects.networking
      den.aspects.ddukes          # user aspect auto-resolves per-user
    ];

    # Hardware-specific; imports stay inside the aspect
    nixos = { ... }: {
      imports = [ ./hardware/sweet16-hardware-configuration.nix ];
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      networking.hostId = "deadbeef";   # required for ZFS
    };

    # Per-host homeManager config (applies to all users on this host)
    homeManager = { ... }: {
      home.stateVersion = "24.05";
    };
  };
}
```

### User aspect (replaces modules/user/*.nix)
```nix
# modules/ddukes.nix
{ den, pkgs, ... }: {
  den.aspects.ddukes = {
    includes = [
      den.provides.primary-user
      (den.provides.user-shell "fish")
      den.aspects.neovim
      den.aspects.git
    ];

    # Forwarded into {nixos,darwin}.users.users.ddukes
    user = { ... }: {
      description    = "Dana Dukes";
      extraGroups    = [ "wheel" "networkmanager" "docker" "video" ];
      isNormalUser   = true;
    };

    homeManager = { pkgs, ... }: {
      home.stateVersion = "24.05";
      home.packages     = with pkgs; [ ripgrep fd bat eza ];
    };
  };
}
```

### Cross-platform aspect using `os` class
```nix
# modules/devtools.nix
{ den, pkgs, ... }: {
  den.aspects.devtools = {
    # `os` applies to both nixos and darwin
    os = { pkgs, ... }: {
      environment.systemPackages = with pkgs; [
        git curl wget jq yq-go
      ];
    };

    homeManager = { pkgs, ... }: {
      home.packages = with pkgs; [ direnv nix-direnv ];
      programs.direnv.enable                = true;
      programs.direnv.nix-direnv.enable     = true;
    };
  };
}
```

### Hardware profile aspect (replaces profiles/hardware/*.nix)
```nix
# modules/hardware/z16.nix
{ den, ... }: {
  den.aspects."hardware-z16" = {
    nixos = { pkgs, lib, ... }: {
      hardware.cpu.amd.updateMicrocode     = lib.mkDefault true;
      hardware.opengl.driSupport           = true;
      hardware.opengl.driSupport32Bit      = true;
      hardware.enableRedistributableFirmware = true;
      boot.kernelModules                   = [ "kvm-amd" ];
    };
  };
}
```

### Networking aspect (replaces modules/core/networking.nix)
```nix
# modules/networking.nix
{ den, ... }: {
  den.aspects.networking = {
    nixos = { ... }: {
      networking.networkmanager.enable = true;
      networking.firewall.enable       = true;
      networking.firewall.allowedTCPPorts = [ 22 ];
      services.resolved.enable         = true;
    };
  };
}
```

---

## provides

### Using built-in batteries
```nix
den.aspects.my-host = {
  includes = [
    # Sets networking.hostName to the Den host name key
    den.provides.hostname

    # Configures users.users.<primaryUser> at system level
    den.provides.primary-user

    # Sets programs.fish.enable = true system-wide + user default shell
    (den.provides.user-shell "fish")
    # Or bash: (den.provides.user-shell "bash")

    # Auto-login on tty1 (useful for kiosk / HPC nodes)
    den.provides.tty-autologin
  ];
};
```

### What each provides does (summary)
| Battery | Effect |
|---|---|
| `den.provides.hostname` | `networking.hostName = <den-host-name>` |
| `den.provides.primary-user` | System-level user account scaffold |
| `(den.provides.user-shell "fish")` | Shell enabled system-wide, set as user default |
| `den.provides.tty-autologin` | Overrides `getty@tty1` with `--autologin <user>` |
| `den._.import-tree` | Imports `_nixos/`, `_darwin/`, `_homeManager/` subdirs by class |

---

## advanced-patterns

### Mutual routing — host ↔ user (v0.13.0, replaces bidirectional)
```nix
# modules/_classes/mutual.nix
# Opt in once per configuration; enables provides.to-users and provides.to-hosts
{ den, ... }: {
  den.ctx.user.includes = [ den._.mutual-provider ];
}
```

```nix
# modules/sweet16.nix — host contributes homeManager defaults to all its users
{ den, ... }: {
  den.aspects.sweet16 = {
    includes = [ den.provides.hostname den.aspects."hw-sweet16" ];
    nixos = { ... }: { imports = [ ./hardware/sweet16-hardware-configuration.nix ]; };

    # All users on sweet16 get these homeManager settings
    provides.to-users.sweet16-hm-defaults = den.aspects.sweet16-hm-defaults;
  };
}

# modules/sweet16-hm-defaults.nix
{ den, ... }: {
  den.aspects.sweet16-hm-defaults = {
    homeManager = { ... }: {
      home.stateVersion = "24.05";
      programs.git.extraConfig.core.autocrlf = false;
    };
  };
}
```

```nix
# modules/ddukes.nix — user contributes system config to all its hosts
{ den, ... }: {
  den.aspects.ddukes = {
    includes = [ den.provides.primary-user (den.provides.user-shell "fish") ];
    user.extraGroups    = [ "wheel" "networkmanager" "docker" "video" ];
    homeManager = { pkgs, ... }: { home.packages = with pkgs; [ ripgrep fd bat ]; };

    # Contributes to every host ddukes is declared on
    provides.to-hosts.ddukes-sys = den.aspects.ddukes-sys;
  };
}

# modules/ddukes-sys.nix
{ den, ... }: {
  den.aspects.ddukes-sys = {
    nixos = { ... }: {
      programs.fish.enable = true;
      security.sudo.wheelNeedsPassword = false;
    };
  };
}
```

### perHost / perUser / perHome (v0.13.0 — prefer over take.exactly)
```nix
# modules/_classes/scoped-includes.nix
{ den, lib, ... }: {
  # Fires only in host context
  den.ctx.host.includes = [
    (den.lib.perHost { nixos.networking.firewall.enable = true; })
    (den.lib.perHost ({ host }: { nixos.networking.hostName = host.name; }))
  ];

  # Fires only in {host,user} context
  den.ctx.user.includes = [
    (den.lib.perUser ({ user }: { homeManager.home.username = user.userName; }))
  ];

  # Fires only in standalone home context
  den.ctx.home.includes = [
    (den.lib.perHome ({ home }: { homeManager.home.stateVersion = "24.05"; }))
  ];
}
```

### OS-bound standalone home (v0.13.0)
```nix
# modules/hosts.nix — declare both the host and the bound standalone home
{ den, ... }: {
  den.hosts.x86_64-linux.sweet16.users.ddukes = {};
  # "ddukes@sweet16" binds to sweet16's OS config; home.userName is set automatically.
  # Rebuild just home: home-manager switch --flake .#"ddukes@sweet16"
  # Rebuild OS:        nixos-rebuild switch --flake .#sweet16
  den.homes.x86_64-linux."ddukes@sweet16" = {};
}
```

### Guarded forwarding — impermanence (opt-in only)
```nix
# modules/impermanence.nix
{ den, lib, ... }: {
  den.aspects.impermanence = let
    persys = { host }: den._.forward {
      each      = lib.singleton true;
      fromClass = _: "persys";
      intoClass = _: host.class;
      intoPath  = _: [ "environment" "persistence" "/nix/persist/system" ];
      fromAspect = _: den.aspects.${host.aspect};
      # Guard: only applies if the impermanence module is actually imported
      guard = { options, ... }: options ? environment.persistence;
    };
  in {
    includes     = [ (den.ctx.host.extend persys) ];
    nixos = { pkgs, ... }: {
      imports = [ inputs.impermanence.nixosModules.impermanence ];
    };
    # Aspect-specific persistent paths (merged by impermanence module)
    persys = {
      directories = [
        "/var/lib/systemd/coredump"
        "/var/log"
        "/var/db/sudo"
      ];
      files = [ "/etc/machine-id" "/etc/ssh/ssh_host_ed25519_key" ];
    };
  };
}
```

### Platform-conditional homeManager alias classes (v0.13.0 — intoPath = [])
```nix
# modules/_classes/hm-platform.nix
# Defines hmLinux / hmDarwin alias classes that route into homeManager,
# gated by pkgs.stdenv.isLinux / isDarwin. Uses root forwarding (intoPath = []).
{ den, lib, ... }: let
  platformHm = { host }: { class, aspect-chain }:
    den._.forward {
      each       = [ "Linux" "Darwin" ];
      fromClass  = p: "hm${p}";
      intoClass  = _: "homeManager";
      intoPath   = _: [];
      fromAspect = _: lib.head aspect-chain;
      guard      = { pkgs, ... }: p: lib.mkIf pkgs.stdenv."is${p}";
      adaptArgs  = { config, ... }: { osConfig = config; };
    };
in {
  den.ctx.user.includes = [ platformHm ];
}

# Usage in any aspect:
den.aspects.my-app = {
  hmLinux  = { pkgs, osConfig, ... }: { programs.mako.enable = true; };  # Wayland notify
  hmDarwin = { pkgs, osConfig, ... }: { programs.terminal-notifier.enable = true; };
};
```

### Role-based class — HPC / multi-tier fleet
```nix
# modules/_classes/roles.nix
{ den, lib, ... }: let
  # Custom class: intersects host and user roles
  roleClass =
    { host, user }:
    { class, aspect-chain }:
    den._.forward {
      each       = lib.intersectLists (host.roles or []) (user.roles or []);
      fromClass  = lib.id;
      intoClass  = _: host.class;
      intoPath   = _: [];
      fromAspect = _: lib.head aspect-chain;
    };
in {
  den.ctx.user.includes = [ roleClass ];
}
```

```nix
# Usage in fleet hosts.nix
{ den, ... }: {
  den.hosts.x86_64-linux.hpc-node-01 = {
    roles = [ "compute" "slurm-worker" ];
    users.svcacct.roles = [ "compute" ];
  };
  den.hosts.x86_64-linux.login-node = {
    roles = [ "login" "slurm-master" ];
    users.ddukes.roles = [ "login" ];
  };
}
```

```nix
# modules/slurm.nix — role-gated aspect
{ den, pkgs, ... }: {
  den.aspects.slurm = {
    # Only fires on hosts with role "slurm-worker"
    "slurm-worker" = { pkgs, ... }: {
      services.slurm.client.enable = true;
    };
    # Only fires on hosts with role "slurm-master"
    "slurm-master" = { pkgs, ... }: {
      services.slurm.server.enable = true;
      services.slurm.dbdserver.enable = true;
    };
  };
}
```

### Sub-aspects via provides
```nix
# Consuming a sub-aspect from another aspect
den.aspects.my-host = {
  includes = [
    den.aspects.gaming.provides.emulators   # only the emulators sub-aspect
    den.aspects.desktop.provides.fonts      # only fonts, not full desktop
  ];
};

# Declaring sub-aspects (provides)
den.aspects.gaming = {
  provides.emulators = den.aspects.gaming-emulators;
  provides.steam     = den.aspects.steam;
  includes = [ den.provides.hostname ];
  nixos = { ... }: { /* full gaming stack */ };
};
```

---

## fleet-patterns

### HPC cluster — full example
```nix
# modules/hosts.nix — HPC fleet declaration
{ den, ... }: {
  # Login / head node
  den.hosts.x86_64-linux.head = {
    roles  = [ "login" "slurm-master" "nfs-server" ];
    users  = {
      ddukes  = { roles = [ "admin" ]; };
      svcjob  = { roles = [ "compute" ]; };
    };
  };

  # Compute nodes — identical config, different hostnames
  den.hosts.x86_64-linux.node-001 = { roles = [ "compute" "slurm-worker" ]; };
  den.hosts.x86_64-linux.node-002 = { roles = [ "compute" "slurm-worker" ]; };
  den.hosts.x86_64-linux.node-003 = { roles = [ "compute" "slurm-worker" "gpu" ]; };

  # GPU aspect adds CUDA + ROCm only to nodes with "gpu" role
  # Storage node
  den.hosts.x86_64-linux.storage-01 = { roles = [ "nfs-server" "zfs" ]; };
}
```

### MicroVM guest/host pattern
```nix
# modules/hosts.nix
{ den, ... }: {
  den.hosts.x86_64-linux.microvm-host = {
    microvm.guests = [ den.hosts.x86_64-linux.svc-vm ];
  };
  den.hosts.x86_64-linux.svc-vm = {};
}

# modules/svc-vm.nix
{ den, ... }: {
  den.aspects.svc-vm = {
    includes  = [ den.provides.hostname ];
    microvm   = { autostart = true; vcpu = 2; mem = 2048; };
    nixos     = { pkgs, ... }: {
      services.nginx.enable = true;
    };
  };
}
```

---

## legacy-compat

### Phase 2 compatibility wrapper — modules/_compat.nix
Wrap the entire old nix-nexus codebase as a single legacy aspect so Den can evaluate it during transition. No existing files need to change.

```nix
# modules/_compat.nix
# NOTE: prefixed with _ so import-tree treats this specially if needed.
# This file wraps nix-nexus legacy modules into Den's pipeline.
{ den, inputs, lib, ... }: {
  den.aspects.legacy-sweet16 = {
    nixos = { ... }: {
      imports = [
        # All original nix-nexus system imports for sweet16
        ../hosts/sweet16/default.nix
        ../profiles/hardware/z16.nix
        ../modules/core/zfs.nix
      ];
    };
    homeManager = { ... }: {
      imports = [
        ../hosts/sweet16/home.nix
        ../modules/desktop/sway-home.nix
        ../modules/user/bash.nix
      ];
    };
  };

  # Host uses the legacy wrapper aspect during Phase 2
  den.hosts.x86_64-linux.sweet16 = {
    aspect  = "legacy-sweet16";    # override default aspect name
    users.ddukes = {};
  };
}
```

### Disabling a legacy file temporarily (import-tree convention)
```bash
# Rename file to start with _ — import-tree will skip it
mv modules/core/sway.nix modules/core/_sway.nix
# After converting to aspect:
rm modules/core/_sway.nix
touch modules/sway.nix   # new unified aspect
```
