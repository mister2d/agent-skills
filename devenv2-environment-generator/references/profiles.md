# Profiles

Profiles are named configuration variations declared in `devenv.nix` and merged into the base
configuration on demand. They activate manually with `--profile`, automatically by hostname or
username, or persistently through `devenv allow`. Use them for per-developer tweaks, machine-specific
services, and alternate toolchain versions — not for anything a teammate must have.

## Declaring a profile

```nix
{ pkgs, config, lib, inputs, ... }:

{
  profiles = {
    backend.module = {
      services.postgres.enable = true;
      services.redis.enable = true;
      env.ENVIRONMENT = "backend";
    };

    frontend.module = {
      languages.javascript.enable = true;
      processes.dev-server.exec = "npm run dev";
    };

    testing.module = { pkgs, ... }: {      # module may be a function
      packages = [ pkgs.playwright ];
      env.NODE_ENV = "test";
    };
  };
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `profiles.<name>.module` | deferred module | `{}` | Configuration merged in when the profile is active |
| `profiles.<name>.extends` | list of string | `[ ]` | Profile names this profile inherits from |
| `profiles.hostname.<name>.module` | deferred module | `{}` | Activates automatically when the machine hostname matches `<name>` |
| `profiles.hostname.<name>.extends` | list of string | `[ ]` | As above |
| `profiles.user.<name>.module` | deferred module | `{}` | Activates automatically when the username matches `<name>` |
| `profiles.user.<name>.extends` | list of string | `[ ]` | As above |

`profiles` is a freeform submodule: any attribute other than `hostname` and `user` is a manual
profile name.

## Referencing `config` inside a profile

The top-level `config` argument does not yet contain the profile's own settings. To read values a
profile itself sets, make `module` a function so it receives the merged `config`.

```nix
{ config, ... }:
{
  # Wrong: config here is the top-level config, without this profile's postgres.
  profiles.broken.module = {
    env.DB_HOST = config.env.PGHOST;
    services.postgres.enable = true;
  };

  # Right: the inner config includes the profile's own values.
  profiles.dev.module = { config, ... }: {
    env.DB_HOST = config.env.PGHOST;
    services.postgres.enable = true;
  };
}
```

## Extends chains

```nix
profiles = {
  base.module = { languages.nix.enable = true; };

  backend = {
    extends = [ "base" ];
    module = { services.postgres.enable = true; };
  };

  frontend = {
    extends = [ "base" ];
    module = { languages.javascript.enable = true; };
  };

  fullstack.extends = [ "backend" "frontend" ];   # module may be omitted
};
```

Parents resolve before children, so a child overrides its parents without `lib.mkForce`.

## Precedence

devenv assigns priorities automatically; conflicts resolve by tier, never by evaluation order.

1. Base configuration (lowest)
2. `profiles.hostname.<name>`
3. `profiles.user.<name>`
4. `--profile` flags (highest); with several flags, the last one wins

All matching tiers activate together. Running `devenv --profile backend shell` on host `ci-server`
as user `developer` merges base + `profiles.backend` + `profiles.hostname."ci-server"` +
`profiles.user."developer"`.

### Package-valued options (devenv 2.2.1)

Before 2.2.1 a profile could not override an option whose value is a derivation — for example
`languages.python.package` — without `lib.mkForce`. Automatic profile priorities now apply to
derivation values too, so a plain assignment wins:

```nix
profiles."python-3.14".module = {
  languages.python.package = pkgs.python314;   # no lib.mkForce needed since 2.2.1
};
```

Mergeable list-valued options such as `packages` still combine across tiers rather than replacing.

## Activating profiles

```bash
devenv --profile backend shell
devenv --profile backend --profile testing shell   # repeatable; last wins on conflict
devenv --profile backend up
devenv --profile backend test
```

`-P` is the short form. `--profile` is a global flag, so it goes before the subcommand.

## Persisting profiles

`devenv allow` stores a profile selection alongside the directory's trust entry; later commands and
the auto-activation shell hook reuse it.

```bash
devenv --profile backend --profile observability allow   # in-tree project (2.2.1)
devenv allow                                             # clears the selection, keeps trust
devenv --from path:../shared-devenv --profile backend allow
```

Persisting profiles for a project with a local `devenv.nix` only works from 2.2.1 onward; earlier
2.2 releases persisted them for `--from` bindings only. An explicit `--profile` on a later command
always takes priority over the stored selection.

## Default profile in devenv.yaml

```yaml
profile: backend
```

`profile` (string) names the profile to activate by default; `--profile` overrides it.

https://devenv.sh/profiles/
