# CLI Reference

The complete `devenv` command surface as of devenv 2.2.1, plus the environment variables devenv sets
and reads, and how shell auto-activation is wired up. Every command, flag and default below was taken
from `devenv --help` / `devenv <command> --help` of the installed 2.2.1 binary. There is no CLI
reference page on devenv.sh — the binary's own help is the source of truth.

## Command tree

| Command | Arguments | Purpose |
| --- | --- | --- |
| `init` | `[TARGET]` | Scaffold `devenv.yaml`, `devenv.nix`, and `.gitignore` |
| `generate` | — | Generate `devenv.yaml` and `devenv.nix` using AI |
| `shell` | `[CMD] [ARGS]...` | Activate the environment; with `CMD`, run it inside and exit |
| `update` | `[NAME]` | Update `devenv.lock` from `devenv.yaml` inputs (one input if named) |
| `search` | `<NAME>` | Search packages and options in nixpkgs |
| `info` | — | Print information about the environment |
| `up` | `[PROCESSES]...` | Start processes in the foreground (or attach, see below) |
| `down` | — | Stop processes running in the background |
| `processes` | subcommand | Process manager control (see below) |
| `tasks` | `run` \| `list` | Run or list tasks |
| `test` | — | Run `enterTest` plus services/processes |
| `container` | `build` \| `copy` \| `run` | Container image workflows |
| `inputs` | `add` | Add an input to `devenv.yaml` |
| `changelogs` | — | Show relevant changelogs |
| `repl` | — | Interactive Nix repl over the devenv configuration |
| `gc` | — | Delete previous shell generations |
| `build` | `[ATTRIBUTES]...` | Build any attribute in `devenv.nix`; prints JSON |
| `eval` | attribute | Evaluate an attribute in `devenv.nix` and return JSON |
| `direnvrc` | — | Print a direnvrc that adds devenv support to direnv |
| `version` | — | Print the devenv version |
| `mcp` | — | Launch the Model Context Protocol server |
| `lsp` | — | Start the nixd language server for `devenv.nix` |
| `hook` | `<SHELL>` | Print the shell hook for auto-activation |
| `allow` | — | Allow auto-activation for the current directory |
| `revoke` | — | Revoke auto-activation for the current directory |

Bare `devenv` prints help, not the version (changed in 2.1).

### init

```bash
devenv init                    # scaffold in the current directory
devenv init myproject          # scaffold into ./myproject
devenv init --include-envrc    # also write .envrc
```

Since 2.2 `devenv init` no longer writes `.envrc`. Pass `--include-envrc`, or set
`DEVENV_INCLUDE_ENVRC`, when you use direnv.

### Processes

```bash
devenv up                      # start all processes in the foreground
devenv up -d                   # start in the background (detached)
devenv up <name> <name>        # start only these processes and their dependencies
devenv down                    # alias of `devenv processes down`
```

`devenv up` with a manager already running attaches to it instead of starting a second one; Ctrl-C
then prompts whether to detach or stop. Non-interactive and AI-agent sessions never block on that
prompt. Naming a process starts it even when `start.enable = false`, and cold-boots a background
manager if none is running.

`up` also accepts `-m/--mode <single|after|before|all>` (default `before`) for the dependency
resolution of process tasks, and `--strict-ports` / `--no-strict-ports`.

```bash
devenv processes up [<name>...]     # same as `devenv up`, same flags
devenv processes attach             # stream status and logs, leave processes running
devenv processes down               # stop everything running in the background
devenv processes wait --timeout 120 # wait for readiness (default 120 seconds)
devenv processes list               # all managed processes and their status
devenv processes status <name>
devenv processes logs <name> -n 100 [--stdout] [--stderr]
devenv processes restart <name>
devenv processes start [<name>]     # omit the name to start everything; -d to detach
devenv processes stop [<name>]      # omit the name to stop everything
```

`devenv processes attach` requires the native process manager.

### Tasks

```bash
devenv tasks run <namespace>:<name>
devenv tasks run <namespace>                 # every task in the namespace
devenv tasks run <namespace>:<name> -m single
devenv tasks run <namespace>:<name> --input key=value --input-json '{"k":1}'
devenv tasks run <namespace>:<name> --show-output
devenv tasks list
devenv tasks list --json                     # machine-readable (2.2+)
```

`-m/--mode` is `single | after | before | all`, default `before` — i.e. dependencies run first.
`--input` is repeatable and parses its value as JSON when valid, otherwise as a string.

### Containers

```bash
devenv container build <name>
devenv container copy <name> --registry docker://ghcr.io/<name>/ [--copy-args ...]
devenv container run <name> [--copy-args ...]
```

### Inputs, building, inspection

```bash
devenv inputs add <name> <url> [--follows <input>]
devenv update [<name>]
devenv build                       # build every output; prints JSON attr -> store path
devenv build outputs.<name>
devenv eval <attribute>            # evaluate to JSON
devenv search <name>
devenv info
devenv repl                        # `inputs` is in scope since 2.2
devenv changelogs
devenv test [--override-dotfile]   # --override-dotfile isolates .devenv in a temp dir
devenv lsp [--print-config]
devenv mcp [--http [<port>]]       # stdio by default; HTTP defaults to port 8080
```

## Global flags

These groups are accepted by every subcommand and are written before the subcommand when they change
how the environment is loaded (`devenv --profile backend shell`).

### Input overrides

| Flag | Description |
| --- | --- |
| `--from <source>` | Load `devenv.nix` from elsewhere: `path:/abs/dir`, `path:./rel`, `github:owner/repo`, `github:owner/repo?dir=sub` |
| `-o, --override-input <name> <uri>` | Override an input from `devenv.yaml` |
| `-O, --option <option>:<type> <value>` | Override a config option; types `string int float bool path pkg pkgs`; `pkgs` appends, `pkgs!` replaces |

```bash
devenv -O languages.rust.enable:bool true -O packages:pkgs "ncdu git" shell
devenv --from path:../shared-devenv shell
```

Since 2.2 a local `--from path:<dir>` source loads that project's full configuration — its
`devenv.yaml` inputs and imports included — and reads its modules live from the directory.

### Nix options

| Flag | Description |
| --- | --- |
| `-j, --max-jobs <count>` | Concurrent Nix builds; defaults to 1/4 of the cores (min 1) |
| `-u, --cores <count>` | Cores per build; defaults to cores / max-jobs (min 1) |
| `-s, --system <system>` | Target system, e.g. `aarch64-darwin` |
| `-i, --impure` / `--no-impure` | Relax or force hermeticity |
| `--offline` | No substituters; treat downloads as up to date |
| `--nix-option <name> <value>` | Pass an option straight to Nix |
| `--nix-debugger` | Enter the Nix debugger on failure |

### Cache options

| Flag | Description |
| --- | --- |
| `--eval-cache` / `--no-eval-cache` | Enable (default) or disable evaluation caching |
| `--refresh-eval-cache` | Force a refresh of the Nix evaluation cache |
| `--refresh-task-cache` | Force a refresh of the task cache |

The eval cache tracks files the configuration reads, including store-path files such as
`scripts.<name>.exec = ./script.sh`, so edits invalidate it automatically. The task cache backs
`tasks.<namespace>:<name>.execIfModified`; `--refresh-task-cache` forces those tasks to re-run.

### Shell options

| Flag | Description |
| --- | --- |
| `-c, --clean [VARS]` | Drop the ambient environment; pass a comma-separated allowlist to let variables through |
| `-P, --profile <name>` | Activate a profile; repeatable, last wins |
| `--reload` / `--no-reload` | Auto-reload when config files change (default on) |
| `--shell <bash\|zsh\|fish\|nu>` | Shell dialect for interactive sessions |

### Secrets, tracing, output

| Flag | Description |
| --- | --- |
| `--secretspec-provider <p>` | Override the SecretSpec provider |
| `--secretspec-profile <p>` | Override the SecretSpec profile |
| `--trace-to <[format:]dest>` | Enable tracing; repeatable. Destinations `stdout`, `stderr`, `file:<path>`, `http(s)://host:port`; formats `json` (default), `pretty`, `full`, `otlp-grpc`, `otlp-http-protobuf`, `otlp-http-json` |
| `-v, --verbose` | Extra debug logs |
| `-q, --quiet` | Silence all logs |
| `--tui <true\|false>` / `--no-tui` | Interactive terminal interface; on by default when interactive |

## Environment variables

### Set by devenv (exported into the shell)

| Variable | Value |
| --- | --- |
| `DEVENV_ROOT` | Project root, where `devenv.nix` lives |
| `DEVENV_DOTFILE` | `$DEVENV_ROOT/.devenv` |
| `DEVENV_STATE` | `$DEVENV_DOTFILE/state` |
| `DEVENV_RUNTIME` | Short-lived per-project dir for sockets: `devenv-<hash>` under `$XDG_RUNTIME_DIR`, else `/tmp/devenv-<hash>`. Never derived from `$TMPDIR` |
| `DEVENV_PROFILE` | Store path of the final package/script profile |

### Read by devenv

| Variable | Effect |
| --- | --- |
| `DEVENV_HOME` | Per-user data dir — GC roots, trust database, cached keys. Default `~/.local/share/devenv` |
| `DEVENV_MAX_JOBS` | Mirrors `-j` |
| `DEVENV_CORES` | Mirrors `-u` |
| `DEVENV_SHELL_TYPE` | Mirrors `--shell` (`bash`, `zsh`, `fish`, `nu`) |
| `DEVENV_TUI` | `true`/`false`; mirrors `--tui` / `--no-tui` |
| `DEVENV_TRACE_TO` | Comma-separated tracing destinations; mirrors `--trace-to` |
| `DEVENV_TRACE_DEFAULT_TO` | Fallback destinations used only when nothing else configures tracing; empty string suppresses an inherited default |
| `DEVENV_INCLUDE_ENVRC` | Mirrors `devenv init --include-envrc` |
| `DEVENV_NO_AI_AGENT` | Any value skips AI-agent auto-detection, restoring normal output and the TUI |

Externally defined variables devenv honors: `SHELL`, `HOME`, `XDG_RUNTIME_DIR`, `XDG_DATA_HOME`,
`XDG_CONFIG_HOME`, `TMPDIR`, `CI` (disables the TUI by default), `RUST_LOG`, `NO_COLOR`, `TERM`,
`HTTP_PROXY` (and `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`), `CACHIX_AUTH_TOKEN`,
`SECRETSPEC_PROVIDER`, `SECRETSPEC_PROFILE`.

https://devenv.sh/reference/environment-variables/

## Auto-activation

Since 2.2 the shell hook looks for **`devenv.nix`**, walking up from the current directory; before
2.2 it looked for `devenv.yaml`. A project with only `devenv.yaml` silently stops auto-activating —
always ship `devenv.nix`.

```bash
eval "$(devenv hook bash)"     # ~/.bashrc
eval "$(devenv hook zsh)"      # ~/.zshrc
devenv hook fish | source      # ~/.config/fish/config.fish, only if the vendor snippet is absent
```

Bash and zsh always need that manual line. A devenv installed via Nix ships
`share/fish/vendor_conf.d/devenv.fish` and `share/nushell/vendor/autoload/devenv.nu`, which fish and
nushell load on their own; for nushell installed another way, save `devenv hook nu` into
`($nu.default-config-dir | path join autoload)`.

```bash
devenv allow      # trust this directory (required before the hook activates it)
devenv revoke     # stop auto-activating
```

The hook spawns `devenv shell` in a subshell, does not nest environments inside a project, and exits
the shell when you leave the project root. Trust lives in the database under `$DEVENV_HOME`.

Alternative: direnv. `devenv direnvrc` prints the direnvrc that teaches direnv about devenv; direnv
modifies the current shell in place instead of spawning a subshell and needs a per-project `.envrc`.

https://devenv.sh/auto-activation/

## Garbage collection

```bash
devenv gc
```

Deletes previous shell generations by removing their GC roots under `$DEVENV_HOME` and then
collecting. It works outside a project directory since 2.2.

https://devenv.sh/garbage-collection/
