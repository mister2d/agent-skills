---
name: devenv2-environment-generator
description: "Generate complete devenv 2.x (2.2+) development environments from project requirement inputs. Use when a user asks to set up a dev environment, scaffold project tooling, configure local services, or generate devenv.nix / devenv.yaml files. Triggers include: 'set up devenv', 'create dev environment', 'configure local services', 'generate devenv config', 'scaffold environment for [language/framework]', or any request for reproducible development tooling with Nix. Always use this skill — not ad-hoc nix config — when the target toolchain is devenv 2.x."
license: MIT
compatibility: Requires devenv 2.2+ (https://devenv.sh). Nix must be installed on the target system.
metadata:
  author: devenv2-environment-generator
  version: "2.2.1"
  devenv-target: "2.2.1"
allowed-tools: Bash(cat:*), Bash(ls:*), Read, Write
---

# devenv Environment Generator (2.x)

Generate production-quality devenv 2.x environments from structured project
requirements. Detailed configuration lives in `references/` — load only the files
the request actually needs (see [Reference Routing](#reference-routing)).

---

## Requirement Intake

Extract or confirm the following before generating any files. Ask for missing
required fields — do not infer or default silently.

| Field | Required | Description | Example |
|---|---|---|---|
| `languages` | Yes | Primary language(s) + version | `python 3.12`, `rust stable` |
| `services` | No | Backing services | `postgres 16`, `redis`, `kafka` |
| `processes` | No | Long-running app processes | `api server`, `worker` |
| `secrets` | No | Secret env vars the app needs | `DATABASE_URL`, `STRIPE_KEY` |
| `extra_packages` | No | CLI tools / utilities | `jq`, `awscli2` |
| `git_hooks` | No | Pre-commit checks | `ruff`, `rustfmt` |
| `lsp` | No | LSP support needed | yes / no per language |
| `polyrepo` | No | Deps on other devenv repos | `github:myorg/my-service` |
| `shell` | No | Preferred shell | `bash`, `zsh`, `fish`, `nu` |
| `profiles` | No | Env variants per machine / user / CI | `ci`, `hostname.laptop`, `user.alice` |
| `ai_tooling` | No | Claude Code hooks / agents / MCP servers in the env | `git-hooks-run` hook, `mcpServers.devenv` |

---

## Reference Routing

Load reference files **at intake time**, keyed on which intake fields were filled.
Never load all of them — each is a standalone 130–300 line document and only the
routed ones are relevant to a given request.

| Request characteristic | Load |
|---|---|
| Any request (language toolchains are always involved) | `references/languages.md` |
| Backing services: postgres, redis, kafka, minio, elasticsearch, … | `references/services.md` |
| Long-running processes, readiness probes, restart policy, file watching, attach | `references/processes.md` |
| Build steps, codegen, DB migrations, seed data, cached/conditional work | `references/tasks.md` |
| Helper commands, generated or checked-in files, env vars, `/etc/hosts`, local TLS certs | `references/scripts-and-files.md` |
| Secrets, API keys, DSNs, credential providers | `references/secrets.md` |
| Pre-commit checks, linters, formatters | `references/git-hooks.md` |
| `devenv.yaml`: inputs, nixpkgs config, `shell`, `backend`, `clean`, `strict_ports`, `require_version` | `references/yaml.md` |
| Monorepo, polyrepo, `imports`, cross-project references, `--from` | `references/composing.md` |
| Per-machine, per-user, or CI variants of one environment | `references/profiles.md` |
| Claude Code integration, AI agent behavior, MCP servers | `references/ai-integration.md` |
| Container images, buildable `outputs`, `enterTest` / `devenv test` | `references/outputs-containers-testing.md` |
| CLI invocation, activation, debugging a broken environment | `references/cli.md` |
| Cachix binary caches, overlays, macOS/Apple SDK, Android, AWS | `references/misc-integrations.md` |

---

## Output Files

```
devenv.nix        # MANDATORY — every project gets one, even a near-empty one.
                  # Since 2.2 auto-activation (shell hook + `devenv allow`) keys on
                  # devenv.nix; a devenv.yaml-only project silently stops activating.
devenv.yaml       # When inputs, imports, secretspec config, require_version,
                  # shell, or nixpkgs config are needed
secretspec.toml   # When any secrets are declared
.gitignore        # Must contain .devenv/ and .direnv/
```

`.envrc` is opt-in only: `devenv init --include-envrc` (or `DEVENV_INCLUDE_ENVRC=1`).
Do not hand-write one unless the user asks for direnv.

---

## devenv.nix — Canonical Skeleton

```nix
{ pkgs, config, lib, inputs, ... }:

{
  packages = with pkgs; [ ];

  languages.<lang>.enable = true;

  services.<name>.enable = true;

  processes.<name> = {
    exec = "...";
    ports.<port-name>.allocate = 8080;
    after = [ "devenv:processes:<name>" ];
    ready.http.get = { port = config.processes.<name>.ports.<port-name>.value; path = "/healthz"; };
    restart.on = "on_failure";        # "never" | "always" | "on_failure"
    restart.max = 5;                  # null for unlimited
    watch.paths = [ ./src ];
    watch.extensions = [ "rs" ];
  };

  tasks."<namespace>:<name>" = {
    exec = "...";
    before = [ "devenv:enterShell" ];
    after = [ "devenv:processes:<name>" ];
    status = "check-if-needed";       # exit 0 = skip
    execIfModified = [ "src/**" ];
  };

  scripts.<name> = {
    exec = ''...'';
    packages = [ pkgs.curl ];
    description = "Help text";
  };

  env = { KEY = "value"; };           # non-secret values only

  git-hooks.hooks.<name>.enable = true;   # requires git-hooks input in devenv.yaml

  enterShell = ''echo "ready"'';
}
```

---

## Breaking Changes from devenv 0.x / 1.x / 2.0

| Change | Version | Required action |
|---|---|---|
| Native process manager is default | 2.0 | Set `process.manager.implementation = "process-compose"` to revert |
| `git-hooks` not bundled by default | 2.0 | Add the input to `devenv.yaml` before using `git-hooks.hooks` |
| `devenv build` outputs JSON | 2.0 | Parse with `jq -r '.["attribute.path"]'` |
| `devenv container --copy <name>` removed | 2.0 | Use `devenv container copy <name>` |
| `pre-commit` command renamed to `prek` | 2.0 | Use the `prek` CLI instead of `pre-commit` |
| `restart` is a submodule | 2.0 | Use `restart.on` / `restart.max` / `restart.window`, not a plain string |
| `watch` is a submodule | 2.0 | Use `watch.paths` / `watch.extensions` / `watch.ignore`, not a plain list |
| `devenv tasks run` default mode changed | 2.1 | Dependency tasks now run by default; `--mode single` for old behavior |
| `devenv` without a command shows help | 2.1 | Use `devenv version` or `devenv --version` |
| `devenv.yaml` keys documented as snake_case | 2.1.1 | Write `strict_ports`, `allow_unfree`, `clean.enabled`; camelCase is legacy-only |
| Auto-activation keys on `devenv.nix`, not `devenv.yaml` | 2.2 | Always emit a `devenv.nix`, even for yaml-driven projects |
| `devenv init` no longer writes `.envrc` | 2.2 | Pass `--include-envrc` or set `DEVENV_INCLUDE_ENVRC` if direnv is wanted |
| `x86_64-darwin` dropped | 2.2 | Intel Macs must pin an older CLI; Apple Silicon can run it under Rosetta 2 |

Migration guide: https://devenv.sh/guides/migrating-to-2.0/
2.2 release notes: https://devenv.sh/blog/2026/07/28/devenv-22-attach-to-running-processes-and-persistent-out-of-tree-environments/

---

## Validation Checklist

Run before finalizing output:

- [ ] Every example and generated project includes a `devenv.nix`
- [ ] Every process that binds a port uses `ports.<port-name>.allocate` — no hardcoded strings
- [ ] Service and process ports are wired through `config.processes.<name>.ports.<port-name>.value`, never a literal port in a URL or flag
- [ ] Secrets are in `secretspec.toml`, not in `env = {}`
- [ ] `secretspec.enable: true` is set in `devenv.yaml` wherever a `secretspec.toml` ships
- [ ] Every `devenv.yaml` key is snake_case
- [ ] `devenv.yaml` declares the `git-hooks` input if `git-hooks.hooks` is used
- [ ] Process dependencies use `devenv:processes:<name>` with optional `@started`, `@ready`, `@completed` suffix
- [ ] One-shot migration/seed processes use `@completed` dependency ordering
- [ ] Language versions are pinned where reproducibility matters
- [ ] `devenv.yaml` present if inputs, imports, secretspec config, `shell`, nixpkgs config, or `require_version` are needed
- [ ] `.gitignore` includes `.devenv/` and `.direnv/`
- [ ] `languages.<lang>.lsp.enable` is only touched to opt **out** — it defaults to `true`
- [ ] `restart` uses submodule syntax: `restart.on`, not a plain string
- [ ] `watch` uses submodule syntax: `watch.paths`, not a plain list
- [ ] Tasks that should run before shell entry use `before = [ "devenv:enterShell" ]`

---

## Agent Workflow

1. **Intake** — Extract requirement fields. Ask for missing required fields.
2. **Load references** — Route the filled intake fields through the table above; read only those files.
3. **Map** — Translate requirements to devenv 2.x constructs.
4. **Draft** — Generate `devenv.nix`, plus `devenv.yaml`, `secretspec.toml`, `.gitignore` as applicable.
5. **Validate** — Run the checklist above. Fix violations before output.
6. **Annotate** — Add inline comments explaining non-obvious choices.
7. **Summarize** — Provide activation commands:

```bash
devenv shell                  # Enter environment (bash, zsh, fish, nu)
devenv up                     # Start all services and processes in the foreground
devenv up -d                  # Start them in the background; a later `devenv up`
                              # attaches to that manager instead of starting a second one
devenv processes attach       # Stream status and logs, leaving processes running on Ctrl-C
devenv down                   # Stop background processes
devenv test                   # Run the test suite
devenv processes list         # List processes and their running state
devenv processes logs <name>  # View process logs
devenv tasks list             # Show the task dependency tree
```

For auto-activation without direnv:

```bash
# bash and zsh need this in the shell rc file; fish and nushell auto-load it
# when devenv is installed via Nix:
eval "$(devenv hook bash)"    # bash
eval "$(devenv hook zsh)"     # zsh

# Then trust the project (from the directory containing devenv.nix):
devenv allow
```

---

## AI Agent Integration

devenv detects coding agents and drops the TUI so output stays token-cheap; opt out
with `DEVENV_NO_AI_AGENT=1`, or force interactive output with `--tui true`.
Environment-level Claude Code config (`claude.code.hooks`, `.agents`, `.commands`,
`.mcpServers`) is covered in `references/ai-integration.md`.

## MCP Integration

`devenv mcp` serves package and option search over stdio, or `devenv mcp --http 8080`
over HTTP; a public instance runs at `mcp.devenv.sh`.
See `references/ai-integration.md` for wiring it into an agent.
