---
name: devenv2-environment-generator
description: "Generate complete devenv 2.0 development environments from project requirement inputs. Use when a user asks to set up a dev environment, scaffold project tooling, configure local services, or generate devenv.nix / devenv.yaml files. Triggers include: 'set up devenv', 'create dev environment', 'configure local services', 'generate devenv config', 'scaffold environment for [language/framework]', or any request for reproducible development tooling with Nix. Always use this skill — not ad-hoc nix config — when the target toolchain is devenv 2.0."
license: MIT
compatibility: Requires devenv 2.0+ (https://devenv.sh). Nix must be installed on the target system.
metadata:
  author: devenv2-environment-generator
  version: "1.0"
  devenv-target: "2.0"
allowed-tools: Bash(cat:*) Bash(ls:*) Read Write
---

# devenv 2.0 Environment Generator

Generate production-quality devenv 2.0 environments from structured project requirements.

Detailed configuration references are in `references/`. Load them on demand:

- [Language toolchain options](references/languages.md)
- [Service configuration](references/services.md)
- [Process manager options](references/processes.md)
- [devenv.yaml, polyrepo, git hooks, secrets](references/composing.md)

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

---

## Output Files

Generate all applicable files. Minimum for a new project:

```
devenv.nix        # Primary environment declaration
devenv.yaml       # Required if: git-hooks, polyrepo, or nixpkgs pin needed
secretspec.toml   # Required if any secrets declared
.gitignore        # Append .devenv/ and .direnv/ entries
```

---

## devenv.nix — Canonical Skeleton

```nix
{ pkgs, config, lib, inputs, ... }:

{
  # ── Packages ───────────────────────────────────────────────────────────
  packages = with pkgs; [ ];

  # ── Languages ──────────────────────────────────────────────────────────
  # See references/languages.md for all options
  languages.<n>.enable = true;

  # ── Services ───────────────────────────────────────────────────────────
  # See references/services.md for all options
  services.<n>.enable = true;

  # ── Processes ──────────────────────────────────────────────────────────
  # See references/processes.md for full process manager reference
  processes.<n> = {
    exec = "...";
    ports.<port-name>.allocate = <preferred-port>;  # always use allocation
    after = [ "devenv:processes:<dep>" ];
    ready.<probe-type> = { ... };
  };

  # ── Tasks ──────────────────────────────────────────────────────────────
  tasks."<ns>:<n>" = {
    exec = "...";
    after = [ "devenv:enterShell" ];
  };

  # ── Scripts ────────────────────────────────────────────────────────────
  scripts.<n>.exec = ''...'';

  # ── Environment (non-secret values only) ───────────────────────────────
  env = { KEY = "value"; };

  # ── Git hooks ──────────────────────────────────────────────────────────
  # Requires git-hooks input in devenv.yaml — see references/composing.md
  git-hooks.hooks.<hook>.enable = true;

  # ── Shell ──────────────────────────────────────────────────────────────
  enterShell = ''echo "ready"'';
}
```

---

## Breaking Changes from devenv 0.x / 1.x

| Change | Required action |
|---|---|
| Native process manager is now default | None, unless relying on process-compose: set `process.manager.implementation = "process-compose"` |
| `git-hooks` not bundled by default | Add to `devenv.yaml` inputs before using `git-hooks.hooks` |
| `devenv build` outputs JSON | Update CI scripts that parse plain store paths |
| `devenv container --copy <n>` removed | Use `devenv container copy <n>` |
| devenv 0.x deprecated | Migrate fully; support dropped in devenv 3 |

Migration guide: https://devenv.sh/guides/migrating-to-2.0/

---

## Validation Checklist

Run before finalizing output:

- [ ] Every process that binds a port uses `ports.<n>.allocate` — no hardcoded strings
- [ ] Secrets are in `secretspec.toml`, not in `env = {}`
- [ ] `devenv.yaml` declares `git-hooks` input if `git-hooks.hooks` is used
- [ ] Process dependencies use `devenv:processes:<n>` or `devenv:processes:<n>@completed`
- [ ] Language versions are pinned where reproducibility matters
- [ ] `devenv.yaml` present if polyrepo inputs or git-hooks required
- [ ] `.gitignore` includes `.devenv/` and `.direnv/`
- [ ] `lsp.enable = true` set for each language where editor integration is wanted
- [ ] One-shot migration/seed processes use `@completed` dependency ordering

---

## Agent Workflow

1. **Intake** — Extract requirement fields. Ask for missing required fields.
2. **Load references** — Read the relevant `references/` files for the languages and services involved.
3. **Map** — Translate requirements to devenv 2.0 constructs.
4. **Draft** — Generate `devenv.nix`, `devenv.yaml`, `secretspec.toml`, `.gitignore`.
5. **Validate** — Run the checklist above. Fix violations before output.
6. **Annotate** — Add inline comments explaining non-obvious choices.
7. **Summarize** — Provide activation commands:

```bash
devenv shell      # Enter environment
devenv up         # Start all services and processes
devenv test       # Run test suite
```

---

## MCP Integration

devenv 2.0 ships an MCP server for package and option search:

```bash
devenv mcp --http 8080
```

Public instance at `mcp.devenv.sh` — usable without a local devenv install.
AI-powered generator: https://devenv.new
