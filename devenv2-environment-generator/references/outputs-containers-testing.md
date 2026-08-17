# Outputs, Containers, and Testing

Three ways a devenv environment produces artifacts instead of just a shell: `outputs` builds packages
with `devenv build`, `containers.<name>` builds OCI images with `devenv container`, and `enterTest`
runs the environment under `devenv test`. All three share the same eval-time conditionals, listed at
the end of this file.

## Outputs

`outputs` is an attribute set of derivations exposed for `devenv build` to consume. It is the bridge
between the module system and packaging: anything you can build in Nix can be surfaced here.

```nix
{ pkgs, config, ... }:

{
  languages.rust.enable = true;
  languages.python.enable = true;

  outputs = {
    # crate2nix reads Cargo.toml / Cargo.lock from the directory
    api = config.languages.rust.import ./api { };

    # uv2nix reads pyproject.toml from the directory
    worker = config.languages.python.import ./worker { };

    # any derivation works
    git = pkgs.git;
  };
}
```

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `outputs` | `outputOf (attribute set)` | `{ }` | Nested attribute sets are allowed (`outputs.foo.ncdu`) |
| `languages.rust.import` | function → function → package | — | `config.languages.rust.import ./dir { }`, backed by crate2nix |
| `languages.python.import` | function → function → package | — | `config.languages.python.import ./dir { }`, backed by uv2nix |

Only `rust` and `python` expose an `import` function in devenv 2.2.1 — no other language module
defines one. For every other language, build the derivation yourself (`pkgs.buildGoModule`,
`pkgs.callPackage ./nix/app.nix { }`, …) and assign it to an `outputs` attribute.

The path passed to `import` is a store-path dependency of the eval cache since 2.2, so edits inside
the imported directory invalidate the cache instead of being silently ignored.

### Building outputs

```bash
devenv build                      # build every attribute under outputs
devenv build outputs.api          # build one output
devenv build outputs.api outputs.worker
```

`devenv build` prints a JSON object mapping attribute path to store path:

```json
{
  "outputs.api": "/nix/store/abc123def456ghi789jkl012mno345pq-api-1.0",
  "outputs.worker": "/nix/store/xyz987wvu654tsr321qpo987mnl654ki-worker-1.0"
}
```

Parse it with `jq` when scripting a release or a container push:

```bash
STORE_PATH=$(devenv build outputs.api | jq -r '."outputs.api"')
nix copy --to "s3://my-bucket" "$STORE_PATH"
```

`devenv build` builds any attribute in `devenv.nix`, not just `outputs.*`; the JSON keys are whatever
attribute paths you asked for.

https://devenv.sh/outputs/

## Containers

`devenv container` turns the environment into an OCI image. Two container targets are predefined:
`shell` (entering the environment, the `devenv shell` equivalent) and `processes` (starting the
configured processes, the `devenv up` equivalent). Define `containers.<name>` for anything else.

Containers need two extra inputs in `devenv.yaml`:

```bash
devenv inputs add nix2container github:nlewo/nix2container --follows nixpkgs
devenv inputs add mk-shell-bin github:rrbutani/nix-mk-shell-bin
```

Building a container on macOS requires a remote Linux builder.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `containers.<name>.name` | null or string | `<top-level name>-<container name>` | Image name |
| `containers.<name>.version` | null or string | `"latest"` | Image tag |
| `containers.<name>.startupCommand` | null / string / package / list of string | `null` | Command run on start; use a list when the entrypoint expects separate args |
| `containers.<name>.copyToRoot` | absolute path or list of absolute path | the git repo | Narrow to a subtree (e.g. `./dist`) to keep the rest of the source out of the image |
| `containers.<name>.entrypoint` | list of anything | `[ entrypoint ]` | Image entrypoint |
| `containers.<name>.workingDir` | string | `"/env"` | Working directory inside the image |
| `containers.<name>.registry` | null or string | `"docker-daemon:"` | Registry the `copy` subcommand targets |
| `containers.<name>.defaultCopyArgs` | list of string | `[ ]` | Forwarded to `skopeo copy` |
| `containers.<name>.maxLayers` | null or signed integer | `1` | Layer budget for the image |
| `containers.<name>.layers` | list of submodules | `[ ]` | Explicit layers; each takes `copyToRoot`, `deps`, `maxLayers`, `perms`, `ignore`, `reproducible` |
| `containers.<name>.enableLayerDeduplication` | boolean | `true` | Drop store paths already present in a lower layer |
| `containers.<name>.fromImage` | null or package | `null` | Base image built with nix2container's `pullImage` |
| `containers.<name>.isBuilding` | boolean | `false` | Read-only; true while this specific container builds |

```nix
{ pkgs, config, lib, ... }:

{
  processes.serve.exec = "python -m http.server";

  containers."prod" = {
    name = "myapp";
    copyToRoot = ./dist;                      # ship build artifacts only
    startupCommand = config.processes.serve.exec;
    registry = "docker://registry.fly.io/";
    defaultCopyArgs = [
      "--dest-creds"
      "x:\"$(${pkgs.flyctl}/bin/flyctl auth token)\""
    ];
  };
}
```

### CLI

```bash
devenv container build <name>                      # print the image spec store path
devenv container run <name>                        # build and run it with Docker
devenv container copy <name>                       # copy to containers.<name>.registry
devenv container copy <name> --registry docker://ghcr.io/
devenv container copy <name> --registry docker://registry.fly.io/ \
  --copy-args="--dest-creds x:$(flyctl auth token)"
```

`--registry` / `-r` and `--copy-args` are flags of the `copy` subcommand and must come after it
(`run` also accepts `--copy-args`). The containers doc page still shows the pre-2.0 ordering
`devenv container --registry … copy <name>`; that form is rejected by devenv 2.2.1 with
`error: unexpected argument '--registry' found`.

### Slim images

Two read-only booleans let one `devenv.nix` serve both the dev shell and the image:

```nix
{ pkgs, config, lib, ... }:

{
  # openssl everywhere, git only outside containers
  packages = [ pkgs.openssl ]
    ++ lib.optionals (!config.container.isBuilding) [ pkgs.git ];

  # narrower: only while the "prod" container builds
  env.MODE = if config.containers."prod".isBuilding then "production" else "development";
}
```

### devcontainer

`devcontainer.enable = true` writes `.devcontainer/devcontainer.json` so VS Code and GitHub Codespaces open the
environment directly. `devcontainer.settings` is an open JSON submodule; notable defaults are
`devcontainer.settings.image` (`"ghcr.io/cachix/devenv/devcontainer:latest"`) and
`devcontainer.settings.updateContentCommand` (`"devenv test"`). Add editor extensions through
`devcontainer.settings.customizations.vscode.extensions`.

https://devenv.sh/containers/

## Testing

`devenv test` builds the environment and runs `enterTest`. Processes and services defined in the
environment are started before the test and stopped afterwards, so a test can talk to them directly.
A `.test.sh` file, when present, always runs as an appended test step (after `enterTest` if both exist).

```nix
{ pkgs, ... }:

{
  services.nginx = {
    enable = true;
    httpConfig = ''
      server {
        listen 8080;
        location / { return 200 "Hello, world!"; }
      }
    '';
  };

  enterTest = ''
    wait_for_port 8080 30
    curl -s localhost:8080 | grep "Hello, world!"
  '';
}
```

devenv injects two helpers into `enterTest`: `wait_for_port <port> <timeout>` and
`wait_for_processes [timeout]` (default 120); the timeout arguments are optional. Prefer port values read from config over literals:
`wait_for_port ${toString config.processes.api.ports.http.value} 60`.

Skip work that only matters interactively with `config.devenv.isTesting`:

```nix
{ lib, config, ... }:

{
  processes = {
    backend.exec = "cargo watch";
  } // lib.optionalAttrs (!config.devenv.isTesting) {
    frontend.exec = "parcel serve";
  };
}
```

For anything with real setup ordering, model it as tasks instead of a long `enterTest` string — a
task with `before = [ "devenv:enterTest" ]` gets dependency resolution and parallelism. See
`tasks.md`.

In CI:

```bash
devenv test --no-tui                # plain output, keeps enterTest output visible (2.2+)
devenv test --override-dotfile      # isolate .devenv in a temp directory
```

https://devenv.sh/tests/

## Eval-time conditionals cheat-sheet

Read-only values you can branch on inside `devenv.nix`. They are set by devenv, never assigned by you.

| Value | Type | True when | Typical use |
| --- | --- | --- | --- |
| `config.git.root` | null or string | Inside a git repo (populated since 1.10) | Resolve repo-relative paths; `null` guard for non-git checkouts |
| `config.devenv.isTesting` | boolean | Running under `devenv test` | Drop dev-only processes, shorten timeouts |
| `config.container.isBuilding` | boolean | Building any container | Trim `packages` for slim images |
| `config.containers.<name>.isBuilding` | boolean | Building that one container | Per-image differences |
| `config.cloud.enable` | boolean | Running on devenv Cloud | Use managed services instead of local ones |

`config.cloud.enable` is documented on https://devenv.sh/cloud/ (private beta) but does not appear in
the public options reference — treat it as beta surface.

https://devenv.sh/reference/options/
