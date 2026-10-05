# Machines

`machines.<name>` declares NixOS, nix-darwin, and home-manager host configurations inside
`devenv.nix`, and `devenv machines` builds, installs, and deploys them over SSH. Experimental since
devenv 2.4 — the interface may change before it is declared stable.

## Defining a machine

```nix
{
  machines.server = {
    system = "x86_64-linux";
    target.host = "root@server.example.com";
    hardware.facter = null;          # or a committed facter report path; see below
    nixos = import ./nixos/server.nix;
  };
}
```

A machine needs a name (letters/digits/underscores/hyphens, starting with a letter or underscore) and
at least one role: `nixos`, `nix-darwin`, or `home-manager`. A machine can combine a system role with
`home-manager`; both share the same `target.host`. NixOS roles require the `disko` input even when you
only deploy to an already-partitioned host:

```bash
devenv inputs add disko github:nix-community/disko --follows nixpkgs
```

A nix-darwin machine uses a Darwin `system` and a `nix-darwin` module instead; `devenv machines deploy`
switches it and there is no `devenv machines install` for macOS — a non-root SSH user needs passwordless
`sudo` because activation is noninteractive, and nix-darwin has no automatic rollback. A home-manager
machine can omit `target.host` to activate locally:

```nix
{
  machines.mac = {
    system = "aarch64-darwin";
    target.host = "admin@mac.example.com";
    nix-darwin = { pkgs, ... }: { environment.systemPackages = [ pkgs.vim ]; };
  };

  machines.me.home-manager = {
    home.username = "jdoe";
    home.homeDirectory = "/home/jdoe";
  };
}
```

`devenv machines deploy mac` deploys over SSH; `devenv machines deploy me` activates locally.
home-manager also has no automatic rollback.

### SSH settings

`target.sshOpts` overrides the defaults devenv sets for direct SSH and `nix copy`
(`StrictHostKeyChecking=accept-new`, a bounded `ConnectTimeout`) — OpenSSH keeps the first value for
most settings, so a conflicting entry here wins over devenv's default. An install that sends secrets,
encryption keys, or extra files requires a known host key from the first connection and disables
forwarding; those stricter settings cannot be overridden through `sshOpts`.

## Option reference

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `machines.<name>.system` | string | `pkgs.stdenv.system` | Target architecture, e.g. `"x86_64-linux"` |
| `machines.<name>.target.host` | null or string | `null` | SSH destination: `user@host`, `user@host:port`, or `ssh://user@host:port`. Unset activates in-process on the current host (home-manager only). `"localhost"` still routes through SSH |
| `machines.<name>.target.sshOpts` | list of string | `[ ]` | Extra `ssh -o` options, applied before devenv's own defaults (`StrictHostKeyChecking=accept-new`, a bounded `ConnectTimeout`); an install that sends secrets/keys/extra files forces stricter non-overridable settings |
| `machines.<name>.nixos` | null or unspecified value (module) | `null` | NixOS configuration for the machine |
| `machines.<name>.nix-darwin` | null or unspecified value (module) | `null` | nix-darwin configuration for the machine |
| `machines.<name>.home-manager` | null or unspecified value (module) | `null` | Home Manager configuration for the machine |
| `machines.<name>.hardware.facter` | null or absolute path or string | `".machines/${name}/facter.json"` | Path to the `nixos-facter` hardware report; `devenv machines install` generates and commits it on first run. `null` opts out (hand-written `hardware-configuration.nix`); only applies to `nixos` |
| `machines.<name>.install.kexec.image` | null or string | `null` | Override kexec installer tarball URL (custom image, non-standard arch, VPN installer) |
| `machines.<name>.install.kexec.postSshPort` | null or uint16 | `null` | SSH port to reconnect to once kexec lands, for every later install phase |
| `machines.<name>.install.encryptionKeys` | attrs of string | `{ }` | Target path → local source path for keyfiles disko needs before it runs (e.g. a LUKS key); values are plain strings so keys never enter `/nix/store` |
| `machines.<name>.install.extraFiles.<name>.source` | string | required | Local path copied onto the installed system after `nixos-install`, before reboot |
| `machines.<name>.install.extraFiles.<name>.owner` | string | `"0:0"` | `chown` target, `uid:gid` |
| `machines.<name>.install.extraFiles.<name>.mode` | string | `"0644"` | `chmod` target |
| `machines.<name>.install.secrets.<name>.secret` | string | required | Name of a secret in the active SecretSpec profile, resolved at install time |
| `machines.<name>.install.secrets.<name>.owner` | string | `"0:0"` | `chown` target |
| `machines.<name>.install.secrets.<name>.mode` | string | `"0600"` | `chmod` target; special bits, group write, and other-user permissions are rejected |
| `machines.<name>.install.secretspec.execution` | one of `"local"`, `"target"` | `"local"` | `local` resolves on the workstation and streams over SSH; `target` sends only a manifest and resolves on the installer |
| `machines.<name>.install.secretspec.profile` | null or string | `null` | Explicit target-side SecretSpec profile override |
| `machines.<name>.install.secretspec.provider` | null or string | `null` | Explicit target-side SecretSpec provider override; non-secret metadata only, never a credential |
| `machines.<name>.install.secretspec.extraPackages` | function → list of package | `_targetPkgs: [ ]` | Extra target-architecture packages (e.g. `sops`, `pass`) for a private resolver runtime during target execution |
| `machines.<name>.install.copyHostKeys` | boolean | `false` | Copy `/etc/ssh/ssh_host_*` from the installer into the installed system, so the known-hosts entry survives first boot |
| `machines.<name>.deploy.healthCheck` | strings concatenated with `"\n"` | `"true"` | Root shell command run on the target after transactional NixOS activation; a nonzero exit or timeout triggers rollback |
| `machines.<name>.deploy.rollbackTimeout` | integer, 30–600 | `300` | Seconds allowed for activation, health checks, and SSH confirmation together |

No `machines.<name>.build.*` or `machines.<name>.deploy.facts` **options** are declared on the options
reference (see Build outputs, next, for the one confirmed `build.<role>` *attribute* that is not a
settable option).

https://devenv.sh/reference/options/#machines

### Install-time bootstrap ordering

| Option | When it runs | Purpose |
| --- | --- | --- |
| `install.encryptionKeys` | Before disko | Send local key files the disk layout needs, such as a LUKS key |
| `install.extraFiles` | After `nixos-install` | Copy local files into the installed system |
| `install.secrets` | After extra files | Write named SecretSpec values into the installed system |

Use `sops-nix` or `agenix` in the NixOS/home-manager modules themselves for ongoing secret
management — `install.*` only seeds what the first boot needs, and never places a secret literal in a
Nix module (it would land in the readable store).

## Build outputs

```bash
devenv machines info                      # list every declared machine, no building or contacting targets
devenv build machines.server              # build every configured role locally, without deploying
devenv build machines.server.build.nixos  # build only the nixos role
```

Each role (`nixos`, `nix-darwin`, `home-manager`) is reachable as its own buildable attribute under
`machines.<name>.build.<role>` once the machine is configured — these are build outputs, not options
declared with `mkOption`, so they do not appear in the options reference itself. A role that needs an
input you have not added gets a `devenv inputs add` hint; building may still need a matching local
architecture or a configured Nix builder (see `--use-machines-as-builders`, below). Building with the
default `hardware.facter` path requires the `nixos-facter-modules` input
(`devenv inputs add nixos-facter-modules github:nix-community/nixos-facter-modules`) and a committed
report.

## CLI: `devenv machines <subcommand>`

Every subcommand also accepts the global flags documented in `cli.md` (`--from`, `-o/--override-input`,
`-O/--option`, the Nix/shell/cache/secretspec/tracing groups). Only subcommand-specific arguments and
flags are listed here.

| Subcommand | Arguments | Flags | Purpose |
| --- | --- | --- | --- |
| `check` | `[NAMES]...` (default: all remote NixOS machines) | `--json` | Check declared SSH access changes without building or deploying |
| `plan` | `[NAMES]...` (default: every machine with `target.host`) | `--json` | Build and save a fleet deployment plan for review |
| `apply` | `<PLAN>` (a saved plan ID or exported JSON file) | `--max-concurrent <N>` | Apply every pinned role in a reviewed plan, without rebuilding |
| `status` | `[NAMES]...` (default: all remote NixOS machines) | — | Read target-side deployment state as JSON, without building or activating |
| `rollback` | `<NAME>` | — | Roll back a transactional NixOS deployment to its recorded previous system |
| `info` | `[NAMES]...` (default: every declared machine) | — | List declared machines and the metadata devenv uses to build, deploy, and install them |
| `install` | `<NAMES>...` (at least one required — it wipes disks) | `--max-concurrent <N>`, `--use-machines-as-builders`, `--phases <kexec,facter,disko,install,reboot>`, `--stop-after-disko`, `--no-reboot`, `--disko-mode <disko\|format\|mount>` | Install NixOS on a fresh target: kexec → hardware detection → disko → install → reboot |
| `deploy` | `[NAMES]...` (default: every machine with `target.host`; a local home-manager machine must be named explicitly) | `--yes`, `--max-concurrent <N>`, `--use-machines-as-builders` | Build, review, and deploy NixOS/nix-darwin/home-manager together |

`install` phases run in the fixed order `kexec, facter, disko, install, reboot`; `--phases` selects a
comma-separated subset, `--stop-after-disko` is shorthand for `kexec,facter,disko`, and `--no-reboot`
for everything but `reboot` — these three are mutually exclusive. `--disko-mode` picks disko's
behavior: `disko` (default) destroys and recreates the layout, `format` creates missing structures
without destroying existing ones, `mount` only mounts an existing layout. `--max-concurrent N` bounds
how many machines a batch activates (or installs) at once; `apply` and `deploy` stop after a failed
batch, `install` has no such stop rule described beyond the concurrency cap.

### `--use-machines-as-builders`

On `install` and `deploy`, treats every declared machine with a reachable `target.host` as a candidate
Nix remote builder for a matching `system`, so a mixed-architecture fleet can cross-build without a
separate builder setup. A fresh `install` target cannot build its own system this way — another
declared machine with the matching architecture must be available. The flag requires the C-Nix backend
and is rejected by plain `devenv build`. Remote builders cannot use `target.sshOpts`; put builder
authentication and routing in an SSH host alias for the user running `nix-daemon` instead, and make
that user trusted (`nix.settings.trusted-users`) or sign paths with a key the target trusts — otherwise
the copy fails with a missing trusted signature.

## Workflows

**Fresh host:** `devenv machines install server1 server2` partitions disks, installs NixOS, and
reboots; names are required because install never runs bare. **Existing host:**
`devenv machines check server` then `devenv machines deploy server` — `deploy` builds every role,
shows a plan, and asks for confirmation (`--yes` skips it for automation); it does not repartition or
reboot for a kernel change. **Review now, apply later:**
`devenv machines plan server` records outputs and facts under `.devenv/machine-plans/<id>/`, then
`devenv machines apply plan-...` copies and activates those exact outputs without rebuilding; a changed
generation or target definition makes the plan stale.

NixOS deployment runs in a target-side systemd service with a watchdog: a failed activation or
`deploy.healthCheck`, or no confirmation before `deploy.rollbackTimeout`, restores the previous system.
`devenv machines status server` reports the last operation (`pending`, `rolled-back`,
`rollback-failed`, or `unknown`); `devenv machines rollback server` restores the previous recorded
system once its service stops. nix-darwin and home-manager deployments have no automatic rollback.

Combining `nixos` (or `nix-darwin`) with `home-manager` on one machine runs the system role first, then
`home-manager` as `home.username`; the two are separate activations — a failed `home-manager` run
leaves a successful system activation in place, and NixOS rollback does not revert `home-manager`
files. A bare `devenv machines deploy` selects every machine with `target.host`; a local
`home-manager`-only machine is never selected implicitly and must be named. By default machines
activate one at a time in name order; a failed batch under `--max-concurrent` stops later batches, but
machines already activated stay applied — the fleet is not one transaction.

## Safety guard

`devenv machines check` compares declared SSH access against facts read from the target, without
building or changing anything. It blocks a reviewed deployment that would disable SSH or root login,
and warns about SSH port changes and administrator-key changes; it cannot verify external firewalls,
dynamic keys, or that you hold a working key. `--json` gives structured output for automation.

https://devenv.sh/machines/
