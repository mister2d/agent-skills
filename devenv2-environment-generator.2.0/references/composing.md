# Composing Environments: devenv.yaml, Polyrepo, Git Hooks, Secrets

## devenv.yaml

Only required when:
- Adding non-default inputs (git-hooks, polyrepo deps, custom nixpkgs pin)
- Composing multiple devenv modules via `imports`

```yaml
inputs:
  nixpkgs:
    url: github:NixOS/nixpkgs/nixpkgs-unstable

  # REQUIRED if using git-hooks.hooks in devenv.nix
  git-hooks:
    url: github:cachix/git-hooks.nix
    flake: false

  # Polyrepo dependency
  my-service:
    url: github:myorg/my-service
    flake: false

imports:
  - ./services/devenv.nix
  - ./tooling/devenv.nix
```

## Polyrepo — referencing another devenv project

### devenv.yaml

```yaml
inputs:
  auth-service:
    url: github:myorg/auth-service
    flake: false
```

### devenv.nix

```nix
{ inputs, ... }:
let
  auth = inputs.auth-service.devenv.config.outputs.auth-service;
in {
  packages = [ auth ];
  processes.auth.exec = "${auth}/bin/auth-service";
}
```

Full guide: https://devenv.sh/guides/polyrepo/

## Out-of-tree environments

```bash
devenv shell --from github:myorg/devenv-configs?dir=rust-web
devenv shell --from path:../shared-config
```

Works with `devenv shell`, `devenv test`, `devenv build`.

## Git hooks

> **devenv 2.0 breaking change**: `git-hooks` is NOT included by default.
> Always add it to `devenv.yaml` before using `git-hooks.hooks` in `devenv.nix`.

```nix
git-hooks.hooks = {
  # Python
  ruff.enable = true;
  ruff-format.enable = true;
  mypy.enable = true;

  # Rust
  rustfmt.enable = true;
  clippy.enable = true;

  # JS/TS
  eslint.enable = true;
  prettier.enable = true;

  # General
  shellcheck.enable = true;
  nixpkgs-fmt.enable = true;
  typos.enable = true;
};
```

## Secrets with SecretSpec

Never put secrets in `env = {}`. Use SecretSpec — it forces explicit prompting
before injecting credentials, which prevents silent leakage to background agents.

### secretspec.toml

```toml
[project]
name = "myapp"
revision = "1.0"

[profiles.default]
DATABASE_URL      = { description = "PostgreSQL DSN", required = true }
STRIPE_SECRET     = { description = "Stripe secret key", required = true }
SENTRY_DSN        = { description = "Sentry error tracking DSN", required = false }
```

### Supported secret backends

- `dotenv` (`.env` file — last resort, avoid for agent environments)
- `keyring` (OS keychain)
- `1password`
- Environment variables

SecretSpec docs: https://secretspec.dev
