# Git Hooks

devenv wires pre-commit-style hooks through `git-hooks.nix`. The generated
`.pre-commit-config.yaml` is a store symlink managed by the files API, hooks are
installed by a task on shell entry, and `devenv test` re-runs them all.

## The input is mandatory (2.0 breaking change)

`git-hooks` stopped being an implicit input in devenv 2.0. Using
`git-hooks.hooks` without declaring it is an evaluation error. (The upstream
`/inputs/` page still shows it in the default `devenv.yaml`; that page is stale —
trust the migration guide and the assertion in the module.)

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
```

Or let the CLI write it:

```bash
devenv inputs add git-hooks github:cachix/git-hooks.nix
```

**devenv 1.x compatibility.** The module resolves `inputs.git-hooks` first and
falls back to `inputs.pre-commit-hooks`, so an existing 1.x input name keeps
working. When migrating, add the new input and point the old name at it:

```yaml
inputs:
  git-hooks:
    url: github:cachix/git-hooks.nix
  pre-commit-hooks:
    follows: git-hooks
```

The `devenv.nix` option namespace was likewise renamed: `pre-commit.*` is a
renamed alias of `git-hooks.*`. Write `git-hooks.*`.

## Enabling hooks

```nix
{ pkgs, ... }:

{
  git-hooks.hooks = {
    # Python
    ruff.enable = true;
    ruff-format.enable = true;
    mypy.enable = true;

    # Rust
    rustfmt.enable = true;
    clippy.enable = true;
    clippy.settings.allFeatures = true;
    clippy.packageOverrides.cargo = pkgs.cargo;
    clippy.packageOverrides.clippy = pkgs.clippy;

    # Go
    gofmt.enable = true;
    golangci-lint.enable = true;

    # JS/TS
    eslint.enable = true;
    prettier.enable = true;

    # Nix
    nixfmt.enable = true;
    deadnix.enable = true;
    statix.enable = true;

    # Cross-cutting
    shellcheck.enable = true;
    shfmt.enable = true;
    typos.enable = true;
    yamllint.enable = true;
    markdownlint.enable = true;
    detect-private-keys.enable = true;
    end-of-file-fixer.enable = true;
    trim-trailing-whitespace.enable = true;

    # Override the package backing a hook
    ormolu.enable = true;
    ormolu.package = pkgs.haskellPackages.ormolu;
  };
}
```

`git-hooks.enable` defaults to `true` as soon as any hook is enabled, so it never
needs to be set by hand. The full catalog is in the options reference.

## Custom hooks

```nix
{
  git-hooks.hooks.unit-tests = {
    enable = true;
    name = "Unit tests";                # shown in the report table
    entry = "make check";               # required; may include fixed arguments
    files = "\\.(c|h)$";                # regex over paths; default "" (all)
    types = [ "text" "c" ];             # default [ "file" ]; use files OR types
    excludes = [ "vendor/.*" ];
    language = "system";                # how pre-commit installs it; Nix provides the tool
    pass_filenames = false;             # default true
  };
}
```

Other per-hook fields worth knowing: `always_run`, `args`, `stages`,
`types_or`, `exclude_types`, `verbose`, `fail_fast`, `require_serial`,
`extraPackages`, `description`, and `before`/`after` for ordering by hook id.
`priority` (integer, equal values run in parallel) only takes effect with the
`prek` runner.

Project-wide knobs: `git-hooks.excludes`, `git-hooks.default_stages`
(default `[ "pre-commit" ]`), `git-hooks.configPath` (default
`.pre-commit-config.yaml`), `git-hooks.addGcRoot` (default `true`).

## The runner is prek

devenv sets `git-hooks.package` to `pkgs.prek` by default — a Rust reimplementation
of `pre-commit`. It also exports `PREK_HOME` into the shell, pointed at the devenv
state directory. To go back to the Python `pre-commit`:

```nix
{ pkgs, ... }:

{
  git-hooks.package = pkgs.pre-commit;   # devenv's default is pkgs.prek
}
```

The options reference renders `pkgs.pre-commit` as this option's default because
that is the declared default in upstream `git-hooks.nix`; devenv overrides it with
`lib.mkDefault pkgs.prek`.

## Lifecycle

- `devenv:git-hooks:install` runs before `devenv:enterShell` and installs the git
  hooks for the configured stages. It warns and skips when there is no `.git`.
- `devenv:git-hooks:run` runs before `devenv:enterTest`, so `devenv test` checks
  every hook across the whole tree — that is the CI entry point.
- `.pre-commit-config.yaml` is a symlink to a generated store file. It does not
  need committing; `devenv init` adds it to `.gitignore`.

https://devenv.sh/git-hooks/

## treefmt as the formatting layer

Instead of enabling one formatter hook per language, drive them all through
treefmt and expose it as a single hook. treefmt needs the `treefmt-nix` input and
its own option tree — configured in `misc-integrations.md`.

```nix
{
  # Runs the treefmt package configured under `treefmt.*` at commit time.
  git-hooks.hooks.treefmt.enable = true;
}
```
