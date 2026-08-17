# devenv.yaml Reference

Complete reference for `devenv.yaml`, the file that declares inputs, imports, and
evaluation-level settings. Every key is `snake_case`; camelCase spellings are legacy
aliases only (documented spelling switched in 2.1.1) and must not be generated.
`devenv.nix` is the only required file — add `devenv.yaml` when you need a key below.

## Schema header

Always start the file with the language-server schema line so editors validate keys:

```yaml
# yaml-language-server: $schema=https://devenv.sh/devenv.schema.json
```

The schema JSON is the authoritative key list and is fetchable at
`https://devenv.sh/devenv.schema.json`.

## Annotated example

```yaml
# yaml-language-server: $schema=https://devenv.sh/devenv.schema.json

inputs:
  nixpkgs:
    url: github:cachix/devenv-nixpkgs/rolling
  git-hooks:
    url: github:cachix/git-hooks.nix
    inputs:
      nixpkgs:
        follows: nixpkgs
  nixpkgs-stable:
    url: github:NixOS/nixpkgs/nixos-25.05

imports:
  - ./services
  - /shared          # leading / resolves from the git root, not the filesystem root

require_version: ">=2.2"
shell: zsh           # bash | zsh | fish | nu
strict_ports: true

nixpkgs:
  allow_unfree: true
  permitted_unfree_packages:
    - terraform

secretspec:
  enable: true
  provider: keyring
  profile: default
```

## Top-level options

| Option | Type | Default | Description |
|---|---|---|---|
| `backend` | `nix` | `nix` | Nix backend used to evaluate `devenv.nix`. yaml-only — there is no `--backend` CLI flag in 2.2.1. |
| `imports` | list of string | `[]` | Relative paths, `/`-rooted paths, or input names to import. See `composing.md`. |
| `impure` | boolean | `false` | Relax hermeticity. CLI: `-i/--impure`, `--no-impure`. |
| `inputs` | attrset of input | `nixpkgs.url: github:cachix/devenv-nixpkgs/rolling` | Nix inputs (see below). |
| `profile` | string | unset | Default profile to activate. CLI `-P/--profile` overrides. See `profiles.md`. |
| `reload` | boolean | `true` | Auto-reload the shell when config files change. CLI: `--reload`, `--no-reload`. |
| `require_version` | boolean or string | unset | `true` pins the CLI to the modules version; a string is a constraint (`>=`, `<=`, `>`, `<`, `=`, or a bare exact version). Added in 2.1. |
| `secretspec` | object | unset | SecretSpec integration; see `secrets.md`. |
| `shell` | string | `$SHELL` then `bash` | Default interactive shell. Added in 2.1. |
| `strict_ports` | boolean | `false` | Error on a taken port instead of auto-allocating the next free one. |
| `clean.enabled` | boolean | `false` | Clean the environment on shell entry. |
| `clean.keep` | list of string | `[]` | Environment variables preserved when cleaning. |

`shell` accepts exactly `bash`, `zsh`, `fish`, `nu`; any other value falls back to
`bash` (2.2 warns on an unsupported value). This is where an intake answer of
"which shell do you use" belongs — it is not a `devenv.nix` option. The `--shell`
CLI flag and `DEVENV_SHELL_TYPE` override it.

`strict_ports` is overridden per-invocation by `--strict-ports` / `--no-strict-ports`,
which are flags on the process-starting subcommands (for example `devenv up`), not
global flags.

## inputs

| Option | Type | Default | Description |
|---|---|---|---|
| `inputs.<name>.url` | string | | Input URI (same URI grammar as Nix flakes). |
| `inputs.<name>.flake` | boolean | `true` | Whether the input contains `flake.nix` or `devenv.nix`. Set `false` for plain source trees. |
| `inputs.<name>.follows` | string | | Inherit another input by name; nested names use `/` (e.g. `base/nixpkgs`). |
| `inputs.<name>.inputs` | attrset of input | | Override the input's own nested inputs (usually to make them follow yours). |
| `inputs.<name>.overlays` | list of string | `[]` | Overlay attribute names to pull in from the input. |

Common URI forms: `github:owner/repo`, `github:owner/repo/<ref-or-rev>`,
`github:org/repo?dir=subdir`, `gitlab:owner/repo/branch`, `git+ssh://…?ref=v1.2.3`,
`git+file:///abs/path`, `sourcehut:~user/repo`, `tarball+https://…`, `path:/abs/path`,
`file+https://…`. `path:` inputs do not respect `.gitignore` and copy the whole
directory into the store — prefer `git+file:` for large trees.

Add inputs without hand-editing:

```bash
devenv inputs add nixpkgs-stable github:NixOS/nixpkgs/nixos-25.05
devenv inputs add my-input github:org/repo --follows nixpkgs
```

Since 2.2, running `devenv inputs add` from a subdirectory writes to the enclosing
project's `devenv.yaml`.

### nixpkgs input choices

| Purpose | URL |
|---|---|
| Recommended default (rolling, CI-tested by devenv) | `github:cachix/devenv-nixpkgs/rolling` |
| Stable release channel | `github:NixOS/nixpkgs/nixos-25.05` |
| Upstream unstable | `github:NixOS/nixpkgs/nixpkgs-unstable` |

Omitting `devenv.yaml` entirely gives you `github:cachix/devenv-nixpkgs/rolling`.
The `git-hooks` input is **not** implicit since 2.0 — declare it whenever
`git-hooks.hooks` is used (see `git-hooks.md`).

## nixpkgs.*

All of these are nested under a `nixpkgs:` mapping.

| Option | Type | Default | Description |
|---|---|---|---|
| `nixpkgs.allow_unfree` | boolean | `false` | Allow unfree packages. Canonical spelling. |
| `nixpkgs.allow_broken` | boolean | `false` | Allow packages marked broken. |
| `nixpkgs.allow_non_source` | boolean | `true` | Allow packages not built from source. |
| `nixpkgs.allow_unsupported_system` | boolean | `false` | Allow packages unsupported on the current system. |
| `nixpkgs.allowlisted_licenses` | list of string | `[]` | nixpkgs license attribute names to allow (`mit`, `asl20`, `gpl3Only`). |
| `nixpkgs.blocklisted_licenses` | list of string | `[]` | nixpkgs license attribute names to block (`unfree`, `bsl11`). |
| `nixpkgs.android_sdk.accept_license` | boolean | `false` | Accept the Android SDK license (or set `NIXPKGS_ACCEPT_ANDROID_SDK_LICENSE=1`). |
| `nixpkgs.cuda_support` | boolean | `false` | Build with CUDA support. |
| `nixpkgs.cuda_capabilities` | list of string | `[]` | CUDA capabilities to target (e.g. `"8.6"`). |
| `nixpkgs.rocm_support` | boolean | `false` | Build with AMD ROCm support. Added in 2.0.7. |
| `nixpkgs.per_platform` | attrset of nixpkgs config | | Per-system overrides keyed by system string; accepts the same keys as `nixpkgs`. |
| `nixpkgs.permitted_insecure_packages` | list of string | `[]` | Insecure package names to permit. |
| `nixpkgs.permitted_unfree_packages` | list of string | `[]` | Unfree package names to permit individually. |

Prefer `permitted_unfree_packages` over a blanket `allow_unfree` so the exception
is auditable:

```yaml
nixpkgs:
  permitted_unfree_packages:
    - terraform
    - vault-bin
  per_platform:
    aarch64-darwin:
      allow_unsupported_system: true
```

### Legacy aliases

`allow_unfree`, `allow_broken`, `allow_unsupported_system`, and
`permitted_insecure_packages` also exist as bare top-level keys. They are marked
deprecated in the schema; 2.2 error messages still suggest the bare
`allow_unfree: true` form. Generate the `nixpkgs.*` form. Pre-2.1.1 camelCase
spellings of every key on this page remain accepted for backwards compatibility
but must never be written into new files — always emit the snake_case name.

## secretspec

| Option | Type | Default | Description |
|---|---|---|---|
| `secretspec.enable` | boolean | `false` | Enable the SecretSpec integration. Added in 1.8. |
| `secretspec.provider` | string | unset | Provider id (`keyring`, `dotenv`, `onepassword`, …). |
| `secretspec.profile` | string | unset | Profile name from `secretspec.toml`. |
| `secretspec.cachix_auth_token` | boolean or string | unset | Require the Cachix token through SecretSpec when `CACHIX_AUTH_TOKEN` is unset. `true` uses the built-in `CACHIX_AUTH_TOKEN` secret name; a string renames only the lookup. Added in 2.2. |

Any project shipping `secretspec.toml` must set `secretspec.enable: true`, or the
declarations are inert. Details in `secrets.md`.

## Local, uncommitted overrides

| File | Role |
|---|---|
| `devenv.nix` | The only required file. Committed. |
| `devenv.yaml` | Inputs, imports, evaluation settings. Committed. |
| `devenv.local.nix` | Same schema as `devenv.nix`, merged on top. Not committed. |
| `devenv.local.yaml` | Same schema as `devenv.yaml`, merged on top. Not committed. Added in 1.10. |
| `devenv.lock` | Resolved input revisions. Commit it in real projects; never commit it in skill examples. |
| `.envrc` | Opt-in direnv glue. Since 2.2 `devenv init` does not create it — pass `--include-envrc` or set `DEVENV_INCLUDE_ENVRC`. |

Use the `.local` files for machine-specific escape hatches — a personal
`nixpkgs` override, an impure toggle, an extra local input — and add both to
`.gitignore` alongside `.devenv/` and `.direnv/`:

```yaml
# devenv.local.yaml — not committed
impure: true
inputs:
  nixpkgs:
    url: path:/home/me/src/nixpkgs
```

https://devenv.sh/reference/yaml-options/
