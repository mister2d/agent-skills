# Composing Environments

How to combine devenv projects: `imports` inside one repository or monorepo,
cross-repository references through inputs, and out-of-tree environments loaded
with `--from`. Key-by-key `devenv.yaml` documentation lives in `yaml.md`; the
`devenv hook` / `devenv allow` command surface lives in `cli.md`.

## imports semantics

`imports` in `devenv.yaml` is a list of things to merge into the current
environment. Three forms are accepted:

```yaml
# yaml-language-server: $schema=https://devenv.sh/devenv.schema.json

inputs:
  devenv:
    url: github:cachix/devenv
    flake: false
  shared-config:
    url: path:../shared-config/
    flake: false

imports:
  - ./frontend                          # relative local directory
  - /shared                             # rooted at the git root (monorepo)
  - shared-config                       # a named non-flake input
  - devenv/examples/supported-languages # subdirectory of a named input
```

Rules that matter when generating configs:

- **Local directories merge both files.** Since 1.10, a locally imported
  directory contributes its `devenv.nix` *and* its `devenv.yaml` (relative and
  absolute paths only). 2.2 fixed the case where a transitively imported
  directory without its own `devenv.yaml` was dropped from the merge.
- **A leading `/` means the git root**, not the filesystem root. In a monorepo,
  `services/api/devenv.yaml` with `imports: [/shared]` picks up
  `<repo>/shared/devenv.nix` no matter how deep the service sits.
- **Entering the top directory merges everything.** From the repository root,
  `devenv up` starts the processes defined in every imported subproject. Entering
  a subdirectory activates only that subdirectory's own configuration.
- **Imported projects' `devenv.yaml` is NOT evaluated when the import comes from
  an input.** A repository intended for import must be `devenv.nix`-only; any
  inputs it needs have to be redeclared by the consumer. This is the single most
  common composition failure.
- `config.git.root` gives the absolute repository root inside `devenv.nix`, which
  is what you want for `processes.<name>.cwd` in a monorepo.

```nix
{ config, ... }:

{
  processes.api = {
    exec = "npm run dev";
    cwd = "${config.git.root}/services/api";   # stable regardless of entry dir
  };
}
```

https://devenv.sh/composing-using-imports/
https://devenv.sh/guides/monorepo/

## Polyrepo: referencing another project's config

Two distinct approaches. Pick by whether you want the other project's whole
environment or just one value out of it.

### Merge everything (imports)

```yaml
inputs:
  my-service:
    url: github:myorg/my-service

imports:
  - my-service
```

Everything in `my-service/devenv.nix` — packages, services, processes, `env`,
`outputs` — merges into your config, so `devenv up` also starts its processes and
`config.outputs.my-service` resolves locally.

### Reference one value (`inputs.<name>.devenv.config`)

```yaml
inputs:
  my-service:
    url: github:myorg/my-service
    flake: false
```

```nix
{ inputs, ... }:

let
  svc = inputs.my-service.devenv.config.outputs.my-service;
in
{
  packages = [ svc ];
  processes.my-service.exec = "${svc}/bin/my-service";
}
```

`inputs.<name>.devenv.config` (2.0+) exposes the other project's evaluated
configuration without merging it. Note `flake: false` here: the input is consumed
as a devenv project, not a flake.

The upstream polyrepo guide still carries a warning that profiles do not work
with cross-project references. That warning predates 2.2/2.2.1, which reworked
profile handling (including `--profile` persistence and package-valued option
overrides) — re-verify before relying on either the warning or its inverse.

https://devenv.sh/guides/polyrepo/

## Out-of-tree environments

`--from` runs a devenv environment whose config lives somewhere else. It is a
global flag, accepted by `shell`, `test`, `build`, `up`, `allow`, and the rest.

```bash
devenv shell --from github:myorg/devenv-configs?dir=rust-web
devenv shell --from github:cachix/devenv?dir=examples/simple
devenv shell --from path:../shared-config
devenv shell --from path:/absolute/path/to/project
```

Source forms are a flake input reference (`github:`, `git+ssh://`, …) or a
filesystem path with an explicit `path:` prefix.

**2.2 — `--from path:` loads the full config.** A path source is no longer just
`devenv.nix`: its `devenv.yaml` inputs and imports are loaded too, and modules
are read live from the directory, so edits in the source tree take effect on the
next evaluation instead of being pinned by a stale eval cache.

**2.2 — persistent binding.** Bind the current directory to an external config
once, and every later devenv command (plus the shell hook) uses it:

```bash
devenv --from path:../shared-config allow
devenv --from github:myorg/devenv-configs?dir=rust-web --profile backend allow
```

Profiles passed alongside `allow` are persisted with the binding; an explicit
`--profile` on a later command wins, and a plain `devenv allow` clears the saved
selection without revoking trust. `devenv revoke` removes the binding.

**Walk-up discovery.** devenv locates a project by walking up from the current
directory until it finds `devenv.nix`, so commands work from any subdirectory.

## Auto-activation summary

`devenv hook <shell>` installs a cd-triggered activation hook; `devenv allow` /
`devenv revoke` manage per-directory trust. Command details, per-shell install
snippets, and the direnv comparison are in `cli.md`.

Two facts that change how you generate projects:

- **Detection keys on `devenv.nix` since 2.2.** Before 2.2 the hook looked for
  `devenv.yaml`, so a `devenv.nix`-only project was invisible; now the inverse is
  true and a `devenv.yaml`-only project silently stops auto-activating. Always
  emit a `devenv.nix`.
- **Trust is explicit.** A project does nothing until `devenv allow` is run in it.

https://devenv.sh/auto-activation/

## Direnv (alternative)

Still supported for teams that want in-place environment modification rather than
a subshell:

```bash
# .envrc
eval "$(devenv direnvrc)"
use devenv
```

Since 2.2 `devenv init` does not write `.envrc` — pass `--include-envrc` or set
`DEVENV_INCLUDE_ENVRC`.
