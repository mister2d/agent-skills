# Misc Integrations

Index of the smaller devenv module surfaces: binary caching, package-set customization, git/prompt
tooling, platform SDKs, credential wrappers, machine definitions, and the extension points. Each
section is a pointer with one verified snippet, not a full guide — follow the doc URL at the end of a
section for depth.

## Cachix (binary caching)

Enabled by default, so builds you or CI perform can be reused instead of rebuilt.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `cachix.enable` | boolean | `true` | Set `false` to drop the integration entirely |
| `cachix.pull` | list of string | `[ "devenv" ]` | Caches to substitute from |
| `cachix.push` | null or string | `null` | Cache to push to; it is also added to `cachix.pull` |
| `cachix.package` | package | `pkgs.cachix` | Cachix client used |

```nix
{
  cachix.pull = [ "mycache" ];   # devenv.cachix.org is always added on top
  # cachix.push = "mycache";     # usually set in devenv.local.nix or CI only
}
```

`devenv.cachix.org` is added to `cachix.pull` by default; it mirrors the official NixOS cache and
backs the `devenv-nixpkgs/rolling` nixpkgs input. Authentication resolves in this order: `CACHIX_AUTH_TOKEN` in the environment, then SecretSpec if
`secretspec.cachix_auth_token` is set, then the token stored by `cachix authtoken` in
`~/.config/cachix/cachix.dhall`. The SecretSpec route is new in 2.2 and needs no `secretspec.toml`
declaration:

```yaml
secretspec:
  enable: true
  provider: keyring
  cachix_auth_token: true          # true = secret named CACHIX_AUTH_TOKEN
  # cachix_auth_token: MY_TEAM_CACHIX_TOKEN   # or a custom secret name
```

The resolved token is used for pull and push without being exported into the shell. Non-interactive
entries (direnv) cannot prompt, so run `devenv shell` once first. See `secrets.md` for the SecretSpec
model.

https://devenv.sh/binary-caching/

## Overlays

Overlays modify the `pkgs` set every module sees. The nix option takes a list of `final: prev:`
functions:

```nix
{ pkgs, inputs, ... }:

{
  overlays = [
    (final: prev: {
      nodejs = (import inputs.nixpkgs-unstable { system = prev.stdenv.system; }).nodejs;
      my-tool = final.callPackage ./nix/my-tool.nix { };
    })
  ];
}
```

To pull an overlay that an input already publishes, name it in `devenv.yaml` instead — the key takes
a list of overlay attribute names exported by that input:

```yaml
inputs:
  rust-overlay:
    url: github:oxalica/rust-overlay
    overlays:
      - default
```

https://devenv.sh/overlays/

## stdenv

`stdenv` (package, default `pkgs.stdenv`) swaps the standard environment used to build the shell —
most often to compile for x86 through Rosetta on Apple Silicon: `stdenv = pkgs.pkgsx86_64Darwin.stdenv;`

https://devenv.sh/reference/options/#stdenv

## Git diff viewers and prompt

All three are single booleans, default `false`:

```nix
{
  difftastic.enable = true;   # structural diffs in git
  delta.enable = true;        # syntax-highlighted diffs in git (sets GIT_PAGER; difftastic sets GIT_EXTERNAL_DIFF)
  starship.enable = true;     # starship.rs prompt in the devenv shell
}
```

`starship` additionally exposes `starship.package`, and `starship.config.enable` with
`starship.config.path` (an existing config file) or `starship.config.settings` (inline TOML).

https://devenv.sh/integrations/difftastic/ · https://devenv.sh/integrations/delta/

## treefmt

Requires the treefmt-nix input: `devenv inputs add treefmt-nix github:numtide/treefmt-nix`.
The confirmed option paths are `treefmt.config.programs.<formatter>.enable` for bundled formatters and
`treefmt.config.settings.formatter.<name>.*` for custom ones. There is no `treefmt.settings.*`.

```nix
{
  treefmt = {
    enable = true;
    config.programs = {
      nixfmt.enable = true;
      rustfmt.enable = true;
    };
    config.settings.excludes = [ "*.lock" ];
  };
}
```

`git-hooks.hooks.treefmt.enable = true` wires it into the pre-commit runner and reuses this package;
see `git-hooks.md`.

https://devenv.sh/integrations/treefmt/

## Apple SDK (macOS)

`apple.sdk` (null or package) pins the versioned macOS SDK bundle that replaced the old
`darwin.apple_sdk.frameworks.*` package list. It defaults to `pkgs.apple-sdk` on Darwin and `null`
elsewhere.

```nix
{ pkgs, ... }:

{
  # Pin a specific SDK; null disables the bundled SDK and uses the system one.
  apple.sdk = if pkgs.stdenv.isDarwin then pkgs.apple-sdk_15 else null;
}
```

Note that devenv 2.2 dropped `x86_64-darwin` as a supported system for the CLI itself.

https://devenv.sh/recipes/macos/

## Android

`android.enable = true` provisions a full Android SDK. Because the SDK is unfree and licensed, both
yaml keys below are required.

```yaml
nixpkgs:
  allow_unfree: true
  android_sdk:
    accept_license: true
```

```nix
{
  android = {
    enable = true;
    platforms.version = [ "32" "34" "36" ];   # default
    buildTools.version = [ "34.0.0" ];        # default
    ndk.enable = true;                        # default true
    emulator.enable = true;                   # default true
    flutter.enable = false;                   # pulls pkgs.flutter when true
  };
}
```

nixpkgs' `androidenv` lags Google's releases; adding the `android-nixpkgs` input
(`devenv inputs add android-nixpkgs github:tadfisher/android-nixpkgs --follows nixpkgs`) switches the
SDK source so newer versions resolve.

https://devenv.sh/integrations/android/

## aws-vault

Wraps commands so they run under `aws-vault exec` with the configured profile, keeping credentials
out of the environment.

```nix
{
  aws-vault = {
    enable = true;
    profile = "my-profile";              # required, passed to aws-vault exec
    awscliWrapper.enable = true;         # wraps pkgs.awscli2
    terraformWrapper.enable = true;      # wraps pkgs.terraform
    opentofuWrapper.enable = true;       # wraps pkgs.opentofu
  };
}
```

Each wrapper is a submodule with `enable` and `package` — `terraformWrapper` is not a bare boolean.

https://devenv.sh/reference/options/#aws-vaultenable

## Machines

`machines.<name>` declares NixOS, nix-darwin, or home-manager configurations alongside the dev
environment, so one repo describes both the shell and the hosts it deploys to.

```nix
{
  machines.builder = {
    system = "x86_64-linux";             # defaults to pkgs.stdenv.system
    nixos = { services.openssh.enable = true; };
    # nix-darwin = { ... };  home-manager = { home.username = "jdoe"; };
  };
}
```

https://devenv.sh/reference/options/#machines

## Changelogs

Modules can ship dated notes that devenv surfaces to users after `devenv update`, and on demand via
`devenv changelogs`. Useful for shared/company modules that change defaults under people.

```nix
{ config, ... }:

{
  changelogs = [{
    date = "2026-07-28";                       # YYYY-MM-DD, enforced by the type
    title = "Postgres bumped to 17";
    description = "Run `devenv processes restart postgres` after re-entering the shell.";
    when = config.services.postgres.enable;    # default true; gate on relevance
  }];
}
```

```bash
devenv changelogs
```

https://devenv.sh/reference/options/#changelogs

## infoSections

`infoSections` (attribute set of list of string, default `{ }`) appends custom sections to
`devenv info` output — a cheap way to surface project-specific URLs or credentials hints.

```nix
{ config, ... }:

{
  infoSections."urls" = [
    "api: http://localhost:${toString config.processes.api.ports.http.value}"
  ];
}
```

https://devenv.sh/reference/options/#infosections

## Custom modules and disabledModules

Encode team defaults as a module in a shared repo, declare it as a non-flake input, and import it —
see `composing.md` for the yaml wiring. Inside a module you can also replace a built-in devenv module:

```nix
{ pkgs, lib, config, ... }:

{
  disabledModules = [ "languages/rust.nix" ];   # path relative to devenv's src/modules

  options.languages.rust.enable = lib.mkOption { type = lib.types.bool; default = false; };
  config = lib.mkIf config.languages.rust.enable { packages = [ pkgs.rustc ]; };
}
```

`disabledModules` is a module-system mechanism, not a devenv option, so it does not appear in the
options reference.

https://devenv.sh/extending/
