# AGENTS.md — Nomad Ops Skill

This file governs how coding agents read, modify, and extend the
`nomad-ops-skill` codebase. It is the authoritative source of truth for
architecture decisions, coding standards, testing requirements, and
operational constraints discovered during development.

---

## Repository layout

```
nomad-ops-skill/
├── AGENTS.md                   # this file
├── SKILL.md                    # agent skill spec (triggers, workflows, guardrails)
├── install.sh                  # one-time installer: symlinks nomad-ops into PATH
├── package.json                # ESM project (type: module)
├── tsconfig.json               # NodeNext, target: ES2024
├── eslint.config.mjs           # ESLint v10 Flat Config
│
├── scripts/
│   ├── nomad                   # entry-point shim (bash); symlinked by install.sh
│   ├── nomad-client.ts         # full Nomad HTTP API client — primary source file
│   ├── redact.test.ts          # unit tests for the secret-redaction subsystem
│   └── sync-docs.sh            # sparse-clones Nomad v1.11.x API .mdx docs
│
└── references/
    ├── api-patterns.md         # blocking queries, pagination, filtering, streaming
    ├── job-spec.md             # full HCL job stanza reference (template/artifact/service)
    └── csi-volumes.md          # CSI access-mode matrix, lifecycle, secrets header
```

`node_modules/` and `references/raw-docs/` are generated; never commit them.

---

## Commands

All commands run from the repository root.

```bash
# Install dependencies
npm install

# Type-check (zero errors required before any commit)
npm run typecheck

# Lint (zero warnings allowed)
npm run lint

# Run redaction unit tests
node --experimental-transform-types scripts/redact.test.ts

# Install the nomad-ops CLI symlink (run once per environment)
bash install.sh

# Seed local API documentation
bash scripts/sync-docs.sh

# Invoke the client directly (bypasses install)
bash scripts/nomad <resource> <action> [args...]
```

The CI gate is: `npm run typecheck` + `npm run lint` + `redact.test.ts`
all pass with exit code 0. No other test runner is used.

---

## Architecture

### Single-file HTTP client

`scripts/nomad-client.ts` contains the entire API surface in one file. This is
intentional: the agent loads it as context, and keeping it in one place avoids
import resolution complexity in the `ts-node` execution model.

**Do not split it into modules.** If it becomes unwieldy, add clearly delimited
section comments (`// ── Section ──────────`) rather than introducing imports.

### Resource client pattern

Each Nomad API resource group is a class. All 20 classes are aggregated by
`NomadClient`, which is the only object the CLI dispatch instantiates:

```
NomadClient
  ├── jobs:          JobsClient
  ├── allocations:   AllocationsClient
  ├── client:        ClientClient          ← Nomad client agent endpoints
  ├── nodes:         NodesClient
  ├── deployments:   DeploymentsClient
  ├── evaluations:   EvaluationsClient
  ├── volumes:       VolumesClient
  ├── plugins:       PluginsClient
  ├── services:      ServicesClient
  ├── variables:     VariablesClient
  ├── namespaces:    NamespacesClient
  ├── nodePools:     NodePoolsClient
  ├── acl:           ACLClient
  ├── operator:      OperatorClient
  ├── agent:         AgentClient
  ├── misc:          MiscClient
  ├── scaling:       ScalingClient
  ├── quotas:        QuotasClient           ← Enterprise
  ├── sentinel:      SentinelClient         ← Enterprise
  └── recommendations: RecommendationsClient ← Enterprise
```

Every method on a resource client must call `nomadRequest` and propagate
`QueryOptions`. Never construct raw URLs inline inside a method body.

### Core HTTP layer

```
nomadRequest<T>(config, method, endpoint, body?, opts?, extra?) → ApiResponse<T>
  └── buildQueryString(opts, extra)
        └── URLSearchParams
```

`extra` is an escape hatch for query parameters that are not part of
`QueryOptions` (e.g. `plugin_id`, `node_id`, `type` on volume list). Always
use `extra` for these — never spread non-`QueryOptions` fields into `opts`.

### Streaming protocols

Three protocols are implemented natively with no external dependencies:

| Protocol | Endpoints | Implementation |
|----------|-----------|----------------|
| **WebSocket exec** | `GET /v1/client/allocation/:id/exec` | `execAlloc()` — raw TCP upgrade via `net`/`tls`, RFC 6455 frame codec |
| **NDJSON stream** | `GET /v1/event/stream`, `GET /v1/agent/monitor` | `eventStream()` — chunked HTTP + `readline`, auto-reconnect with exponential backoff + `AbortSignal` |
| **Chunked log stream** | `GET /v1/client/fs/logs/:id` | `ClientClient.streamLogs()` — chunked HTTP, base64 decode |

Do not introduce the `ws` package or any other WebSocket library. The
RFC 6455 implementation in `execAlloc` is self-contained and sufficient.

### Async concurrency helpers

Four helpers are exported for use in programmatic contexts:

| Helper | Purpose |
|--------|---------|
| `pMap(items, fn, concurrency)` | Bounded parallel execution |
| `batchAllocStatus(cfg, ids, concurrency)` | Parallel alloc detail fetch |
| `watchDeployment(cfg, id, onChange, timeoutMs)` | Blocking-query deployment poll |
| `waitForJobAllocs(cfg, jobId, count, timeoutMs)` | Wait for N running allocs |

### Namespace default

`buildConfig()` defaults `namespace` to `"*"` when `NOMAD_NAMESPACE` is unset.
This ensures all list operations span namespaces in multi-tenant clusters.
Never change this default to `"default"`.

---

## Coding standards

### TypeScript

- Strict mode is non-negotiable. All `tsconfig.json` flags stay enabled.
- `no-explicit-any` is an error. Use `unknown` for untyped API responses and
  narrow with type guards or type assertions at the point of use.
- `noUncheckedIndexedAccess` is enabled — all array/object index accesses
  require null checks or non-null assertions with justifying comments.
- Prefer `const`; use `let` only when mutation is required.
- All async functions must be awaited or returned. `no-floating-promises` is
  enforced by ESLint.
- Public methods on resource clients must have explicit return type annotations.
- Errors thrown from `nomadRequest` must be `NomadApiError`. Never throw raw
  strings.

### URLSearchParams in template literals

`URLSearchParams` objects must be coerced to string before interpolation:

```typescript
// correct
`/endpoint?${qs.toString()}`

// wrong — triggers @typescript-eslint/restrict-template-expressions
`/endpoint?${qs}`
```

### Argument access in CLI dispatch

Use `getArg(idx)` — never index `filteredRest` directly:

```typescript
// correct
const jobId = getArg(0);

// wrong — noUncheckedIndexedAccess will fire, and the error is silent
const jobId = filteredRest[0];
```

### No-fallthrough in switch dispatch

Cases that terminate via `process.exit()` require an eslint-disable comment
on the subsequent case:

```typescript
process.exit(execResult.exitCode);
// eslint-disable-next-line no-fallthrough
case "next-case": {
```

---

## Security constraints

These constraints are permanent. Do not relax them.

### Output redaction

All data printed to stdout passes through `printJson(data)`, which calls
`redactSecrets(data)` before serialization. `redactSecrets` is a recursive
walker that replaces values at any depth for keys in `REDACTED_KEYS`:

```typescript
const REDACTED_KEYS = new Set([
  "SecretID", "secret_id", "SecretId",
  "AccessorID",
  "OneTimeSecretID",
]);
```

**When adding new API methods that return sensitive fields**, update
`REDACTED_KEYS` and add a corresponding test case in `redact.test.ts`.
The test suite must pass before the change is committed.

### Auth error messages

The 401/403 error handler must not include any portion of the token value —
not a prefix, not a hash, not a length hint. The current message is:

```
Auth error [403]: token rejected. Token may be expired, revoked, or lack
the required ACL policy for this endpoint.
  endpoint : <endpoint>
```

This is sufficient for diagnosis. Do not add token information.

### Env var immutability

`buildConfig()` reads env vars; it never writes them. No code path in the
client may call `process.env["NOMAD_TOKEN"] = ...` or equivalent.

---

## Entry-point shim (`scripts/nomad`)

The shim self-resolves its real filesystem location using `readlink -f`
(GNU/Linux) with a pure-bash symlink-walk fallback (macOS/BSD). This means
it works correctly whether invoked:

- as `nomad-ops` via a symlink placed by `install.sh`
- as `bash /absolute/path/scripts/nomad`
- as `./scripts/nomad` from the skill root

**The shim must never use `dirname "$0"` without following symlinks first.**
That pattern was the root cause of multiple path-doubling bugs during
development. Use `readlink -f "${BASH_SOURCE[0]}"` exclusively.

### NixOS / no-Node environments

The shim detects whether a modern `node` (v24+) is available. If so, it uses
`--experimental-transform-types` for high-performance native execution.
If not, it provisions jq + nodejs_24 + python312 via `nix-shell` and re-execs.
The command passed to `nix-shell --run` is built using `printf '%q'` to quote
each argument — this is required because `nix-shell --run` executes under
`$SHELL -c`, not under bash, and argument boundaries must survive that transition.

`python312` is included in the nix-shell package list because `ts-node`'s
dependency chain requires a Python interpreter on some platforms.

---

## `install.sh`

`install.sh` self-resolves using the same `readlink` pattern as the shim.
It is safe to invoke by absolute path from any working directory. It handles
two layouts:

| Location of `install.sh` | `SKILL_DIR` resolution |
|--------------------------|----------------------|
| Skill root (canonical)   | `SELF_DIR` |
| Inside `scripts/`        | `dirname SELF_DIR` |

The second case exists as a fault-tolerance measure after operational
experience showed agents placing the file in the wrong location.

Default install target: `~/.local/bin/nomad-ops`. Override with `--prefix`.
Supports `--uninstall` for clean removal.

---

## `sync-docs.sh`

Sparse-clones `content/nomad/v1.11.x/content/api-docs/` from
`hashicorp/web-unified-docs` into `references/raw-docs/`. Key design points:

- Clone directory is `<skill_root>/.nomad-docs-clone` — **not** inside
  `references/raw-docs/`. Nesting the clone inside the rsync destination
  caused `rsync --delete` to attempt removal of `.git` internals (a prior bug).
- rsync exit code 24 ("files vanished") is masked; all other non-zero codes
  propagate as errors.
- `advice.detachedHead false` suppresses the git detached HEAD message.

---

## References

The three files in `references/` are consumed by the agent at query time.
They are not imported by `nomad-client.ts`. Update them when the Nomad API
changes or when new stanzas/patterns are validated against a live cluster.

| File | Covers |
|------|--------|
| `api-patterns.md` | Blocking queries, pagination, filtering expressions, streaming protocols, concurrency helpers, Task API UDS |
| `job-spec.md` | Full HCL stanza tree: `job → group → task`, template, artifact, service, volume, identity, NUMA, Vault, Consul Connect |
| `csi-volumes.md` | AccessMode × AttachmentMode matrix, register vs create vs delete, snapshot lifecycle, secrets header, host volumes, per-alloc pattern |

---

## Known issues and prior bugs

Understanding past failures helps avoid reintroducing them.

| Bug | Root cause | Fix applied |
|-----|-----------|-------------|
| `jobs list` returned `[]` in multi-namespace clusters | `buildConfig()` left `namespace` as `undefined`, defaulting to Nomad's `"default"` namespace | Default changed to `"*"` |
| `volumes list` silently dropped `plugin_id`/`node_id` filters | `VolumesClient.list()` spread camelCase keys into `opts`; `buildQueryString` ignored unknown keys | Destructured to `plugin_id`/`node_id` via the `extra` parameter on `nomadRequest` |
| `scripts/nomad` resolved to wrong directory when symlinked | `dirname "$0"` returns the symlink's directory, not the real file's directory | Replaced with `readlink -f "${BASH_SOURCE[0]}"` |
| `install.sh` produced `scripts/scripts/nomad` path when invoked by absolute path | Same `dirname "$0"` trap | Applied `readlink` self-resolution + dual-layout detection |
| `nix-shell` re-exec failed silently | Original shim re-exec'd `$0` via `printf '%q'`; `$0` was a relative path, and `nix-shell --run` runs under `/bin/sh` not bash | Replaced with explicit `npx ts-node $CLIENT "$@"` command string built with `printf '%q'` per argument |
| Agent overwrote `NOMAD_ADDR` and cleared `NOMAD_TOKEN` | Security guardrail said "never print secrets" but gave no instruction about env var mutation; agent filled the gap by resetting to "safe" defaults | Added explicit "never modify cluster env vars" rule as guardrail #1 in `SKILL.md` |
| `nomad-ops` not found; agent used raw script path instead of installing | `SKILL.md` fallback path allowed bypassing `install.sh`; agent had no incentive to fix the root cause | Resolution section reordered: install first, raw-path direct invocation removed as a fallback |
| `install.sh` not found at skill root | File was generated during session but not copied to outputs at the root level | Delivery corrected; `install.sh` lives at `<skill_root>/install.sh` |
| Malformed URLs (double `?`) | Methods manually built query strings while `nomadRequest` also appends one | Refactored all clients to use the `extra` parameter of `nomadRequest` |
| `npx ts-node` slow / outdated | Legacy runner lacked native performance and threw compatibility warnings | Migrated to Node 24 native `--experimental-transform-types` |

---

## What not to do

- **Do not** split `nomad-client.ts` into multiple files or introduce a module
  bundler.
- **Do not** add runtime npm dependencies. The client uses only Node.js
  built-ins: `crypto`, `fs`, `http`, `https`, `net`, `path`, `readline`, `tls`,
  `url`.
- **Do not** change the `namespace` default in `buildConfig()` from `"*"` to
  `"default"` or `undefined`.
- **Do not** print, log, or truncate secret values anywhere in the codebase —
  including in debug output, error messages, or comments that might be echoed.
- **Do not** use `dirname "$0"` in bash scripts without `readlink -f` first.
- **Do not** add `noUncheckedIndexedAccess: false` or similar relaxations to
  `tsconfig.json` to silence errors. Fix the code instead.
- **Do not** introduce a `ws`, `axios`, `node-fetch`, or similar package. All
  HTTP and WebSocket handling is done with Node.js built-ins by design.
