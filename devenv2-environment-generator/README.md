# devenv2-environment-generator

A coding agent skill for generating complete, production-quality **devenv 2.x**
development environments from structured project requirements. Current target:
**devenv 2.2.1**.

## What this skill does

Given project requirement inputs (languages, services, processes, secrets, tooling,
profiles, AI integration), the agent generates:

- `devenv.nix` — the primary declarative environment config, and the only mandatory
  file: since 2.2, auto-activation keys on `devenv.nix`, so a project without one
  silently stops activating
- `devenv.yaml` — inputs, imports, nixpkgs config, `shell`, `require_version`,
  secretspec settings (all keys snake_case since 2.1.1)
- `secretspec.toml` — explicit secret declarations with provider-agnostic injection
- `.gitignore` — exclusions for `.devenv/` and `.direnv/`

Output targets devenv 2.x behavior: the native Rust process manager, dynamic port
allocation, SecretSpec, the incremental evaluation cache, profiles, native
bash/zsh/fish/nushell support, and background-manager attach.

---

## Repository layout

```
SKILL.md            # the skill the agent loads; intake, routing table, skeleton, checklist
references/         # 14 on-demand reference files, routed from the intake fields
examples/           # 6 complete, self-consistent example projects
.claude/            # maintenance agents and the /bump-devenv skill (see Maintenance)
```

`SKILL.md` deliberately stays small. Everything deep — per-language options, service
catalogs, task semantics, containers, the CLI surface — lives in `references/` and is
loaded only when the request calls for it.

---

## Examples

| Directory | Stack |
|---|---|
| `examples/python-fastapi-postgres/` | Python 3.12 · FastAPI · PostgreSQL 16 · Alembic |
| `examples/rust-web-service/` | Rust stable · sqlx · PostgreSQL 16 |
| `examples/node-react-redis/` | Node.js 22 · TypeScript · Redis |
| `examples/go-grpc-service/` | Go 1.22 · gRPC · grpc-gateway · PostgreSQL 16 |
| `examples/multi-service-ml/` | Python 3.11 · Celery · PostgreSQL · Redis · MinIO |
| `examples/claude-code-agent-env/` | Python · PostgreSQL · `claude.code` hooks + MCP · profiles · attach workflow |

Each example ships a `devenv.nix`, a `.gitignore`, and — where it needs them — a
`devenv.yaml` and `secretspec.toml`. `devenv.lock` and `.devenv/` are never committed.

---

## What changed in the 2.2 line

- **Attach to background processes.** `devenv up -d` starts a manager in the
  background; a later `devenv up` attaches to it rather than starting a second one,
  and `devenv processes attach` streams status and logs without stopping anything on
  Ctrl-C. `devenv down` stops them.
- **Auto-activation moved to `devenv.nix`.** The shell hook and `devenv allow` look
  for `devenv.nix`; `devenv.yaml`-only projects no longer activate.
- **`.envrc` is opt-in.** `devenv init` stopped writing one — use
  `devenv init --include-envrc` or `DEVENV_INCLUDE_ENVRC`.
- **Persistent out-of-tree environments.** `devenv --from <source> allow` binds a
  directory to an external config; profiles can be persisted alongside it.
- **`x86_64-darwin` dropped.** Intel Macs need an older pinned CLI.
- **snake_case devenv.yaml** (documented from 2.1.1) — `strict_ports`,
  `nixpkgs.allow_unfree`, `clean.enabled`; camelCase remains legacy-compatible only.
- **2.2.1:** profiles can override package-valued options without `lib.mkForce`, and
  `devenv --profile <name> allow` persists profiles for in-tree projects.

Other things the skill handles that predate 2.2: dynamic port allocation so parallel
agent instances never clash, SecretSpec instead of `.env`, declarative readiness
probes and restart policies, `devenv hook <shell>` activation without direnv, the
requirement to declare the `git-hooks` input explicitly, and the incremental
evaluation cache.

---

## Usage

Install it as an agent skill — copy or symlink this directory into your agent's
skill directory (for Claude Code, `~/.claude/skills/devenv2-environment-generator/`),
and it triggers automatically on dev-environment requests.

To invoke it explicitly, point the agent at this repository's `SKILL.md`:

```
Use the devenv2-environment-generator skill (SKILL.md at the repo root) to generate a
devenv environment for:
- Language: Python 3.12 with FastAPI
- Services: PostgreSQL 16, Redis
- Secrets: DATABASE_URL, OPENAI_API_KEY
- Git hooks: ruff, mypy
- Profiles: ci
```

---

## Maintenance

Version bumps are automated. This repository carries its own maintenance tooling:

- `.claude/agents/` — `devenv-release-scout` (collects the release delta),
  `devenv-docs-mapper` (re-maps upstream docs and the feature taxonomy),
  `devenv-skill-auditor` (finds defects and stale claims in the current tree),
  `devenv-reference-writer` (rewrites a work package of files), and
  `devenv-skill-verifier` (checks the result against the frozen contract).
- `.claude/skills/bump-devenv/` — the orchestration skill that drives them.

When a new devenv release lands, run `/bump-devenv`. It anchors on
`metadata.devenv-target` in `SKILL.md` — the single authoritative version string in
this repository — diffs upstream against it, partitions the work, and updates
`SKILL.md`, `references/`, and `examples/` together. Do not hand-edit the version in
more than one place; change `metadata.devenv-target` and let the bump propagate.

---

## References

- devenv 2.2 release: https://devenv.sh/blog/2026/07/28/devenv-22-attach-to-running-processes-and-persistent-out-of-tree-environments/
- devenv 2.0 release: https://devenv.sh/blog/2026/03/05/devenv-20-a-fresh-interface-to-nix/
- Migration guide: https://devenv.sh/guides/migrating-to-2.0/
- Options reference: https://devenv.sh/reference/options/
- devenv.yaml options: https://devenv.sh/reference/yaml-options/
- Auto-activation: https://devenv.sh/auto-activation/
- Processes: https://devenv.sh/processes/
- Profiles: https://devenv.sh/profiles/
- SecretSpec: https://devenv.sh/integrations/secretspec/ · https://secretspec.dev
- devenv MCP server / AI generator: https://devenv.sh/mcp/ · https://devenv.new
