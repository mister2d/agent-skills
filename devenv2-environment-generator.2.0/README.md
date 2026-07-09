# devenv2-environment-generator

A coding agent skill for generating complete, production-quality **devenv 2.0** development
environments from structured project requirements.

## What this skill does

Given project requirement inputs (languages, services, processes, secrets, tooling),
the agent generates:

- `devenv.nix` — primary declarative environment config
- `devenv.yaml` — inputs and imports (polyrepo, git-hooks, nixpkgs pin)
- `secretspec.toml` — explicit secret declarations with provider-agnostic injection
- `.gitignore` — standard exclusions for `.devenv/` and `.direnv/`

Outputs are correct for devenv 2.0 — using the native process manager, dynamic port
allocation, SecretSpec integration, and the incremental evaluation cache.

---

## Skill file

`SKILL.md` — loaded by the agent before generating any output.

---

## Examples

| Directory | Stack |
|---|---|
| `examples/python-fastapi-postgres/` | Python 3.12 · FastAPI · PostgreSQL 16 · Alembic |
| `examples/rust-web-service/` | Rust stable · sqlx · PostgreSQL 16 |
| `examples/node-react-redis/` | Node.js 22 · TypeScript · Redis |
| `examples/go-grpc-service/` | Go 1.22 · gRPC · grpc-gateway · PostgreSQL 16 |
| `examples/multi-service-ml/` | Python 3.11 · Celery · PostgreSQL · Redis · MinIO |

---

## Key devenv 2.0 concepts the skill handles

### Dynamic port allocation
All processes use `ports.<n>.allocate` so parallel agent instances never clash:

```nix
processes.api = {
  ports.http.allocate = 8000;
  exec = "uvicorn app:app --port ${toString config.processes.api.ports.http.value}";
};
```

### SecretSpec over .env
Secrets are declared in `secretspec.toml` and injected on demand — not silently
read from flat files:

```toml
[profiles.default]
DATABASE_URL = { description = "PostgreSQL DSN", required = true }
```

### Native process manager
devenv 2.0 ships a built-in Rust process manager (default). Dependency ordering,
readiness probes, restart policies, and file watching are all declarative.

### git-hooks must be declared
`git-hooks` is no longer bundled by default. Configs that use `git-hooks.hooks`
must add the input to `devenv.yaml`.

### Evaluation cache
The incremental cache (content-hash based, per-attribute) means repeat `devenv shell`
invocations are near-instant. Cache busts only when source files, env vars,
or devenv internals change.

---

## Usage

Point the agent at the skill:

```
Use the skill at devenv2-skill/SKILL.md to generate a devenv 2.0 environment for:
- Language: Python 3.12 with FastAPI
- Services: PostgreSQL 16, Redis
- Secrets: DATABASE_URL, OPENAI_API_KEY
- Git hooks: ruff, mypy
- LSP: yes
```

Or drop the `SKILL.md` into your agent's skill directory and it will trigger automatically
on dev environment generation requests.

---

## References

- devenv 2.0 release: https://devenv.sh/blog/2026/03/05/devenv-20-a-fresh-interface-to-nix/
- Migration guide: https://devenv.sh/guides/migrating-to-2.0/
- Options reference: https://devenv.sh/reference/options/
- Process manager: https://devenv.sh/processes/
- SecretSpec: https://secretspec.dev
- devenv MCP server / AI generator: https://devenv.new
