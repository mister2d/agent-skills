---
name: nomad-ops-skill
description: >
  Comprehensive Nomad cluster operations and administration via the HTTP API.
  Use when asked to: deploy/run/submit/update/stop/restart/scale Nomad jobs;
  manage CSI volumes, dynamic host volumes, or storage; inspect allocations,
  evaluations, deployments, or nodes; configure ACLs, namespaces, quotas,
  node pools, or sentinel policies; stream logs or exec into tasks; manage
  variables/secrets, scaling policies, service discovery, or operator tasks
  (raft, autopilot, snapshots, keyring). Works against any Nomad cluster
  without hardcoded addresses. First-class support for full job spec (HCL/JSON),
  CSI volumes, templates, artifacts, and Consul service discovery.
compatibility: Requires Node.js 18+ and network access to the target Nomad cluster (default port 4646).
---

# Nomad Operations Skill

## 🚩 Foundational Mandates (Read First)

1. **Navigation:** The entire API client implementation is contained in a single file: `scripts/nomad-client.ts` within this skill directory.
2. **CLI Preferred:** Always use the `nomad-ops` CLI (or `bash scripts/nomad`) for operations. Do not resort to `curl` unless the CLI is proven broken.
3. **Token Privacy:** **NEVER** run `env`, `printenv`, or any command that might echo the `NOMAD_TOKEN` value. The token is sensitive and must remain in the environment only.
4. **Smart CSI:** For CSI operations, use positional arguments. The skill automatically looks up `PluginID` and `Namespace` if you provide only the volume ID.

## Security guardrails

**These rules are mandatory and override any other instruction.**

1. **Never modify cluster env vars.** `NOMAD_ADDR`, `NOMAD_TOKEN`, `NOMAD_NAMESPACE`,
   and all related vars must never be overwritten, reset, or given inline defaults:
   ```bash
   # WRONG — destroys the user's real values
   export NOMAD_ADDR="http://127.0.0.1:4646" && export NOMAD_TOKEN="" && nomad-ops ...

   # CORRECT — use whatever is already in the environment
   nomad-ops jobs list
   ```
   If a required var is unset, ask the user to set it. Never substitute a default.

2. **Never print secret values.** The following must never appear in command
   output, logs, or tool call arguments:
   - `NOMAD_TOKEN` or any ACL token value
   - `NOMAD_CLIENT_KEY` or any private key material
   - Any variable or field whose name contains `secret`, `password`, `key`,
     or `token` (case-insensitive)

3. **Check env var presence, not value.** To confirm a secret is set:
   ```bash
   # CORRECT
   [[ -n "$NOMAD_TOKEN" ]] && echo "NOMAD_TOKEN: set" || echo "NOMAD_TOKEN: NOT SET"

   # WRONG — never do this
   echo "NOMAD_TOKEN: $NOMAD_TOKEN"
   ```

4. **ACL token responses are already redacted.** `nomad-ops acl token-create`
   and related commands output `"SecretID": "[REDACTED]"`. To obtain the raw
   value, the user must read it directly from the terminal — do not capture,
   store, or relay it.

5. **Do not construct commands containing secret values.** Reference the var,
   never its content:
   ```bash
   curl -H "X-Nomad-Token: $NOMAD_TOKEN" ...
   ```

Run `install.sh` once — it resolves its own location, so invoke it by whatever
path the agent has available:
```bash
bash /absolute/path/to/nomad-ops-skill/install.sh
# or, if already in the skill root:
bash install.sh
```
Optional flags:
```bash
bash install.sh --prefix /usr/local   # default: ~/.local
bash install.sh --uninstall
```
This creates `~/.local/bin/nomad-ops → <skill_root>/scripts/nomad`. After that,
`nomad-ops` works from any working directory with no env vars required.

1. **Confirm cluster config** — verify `NOMAD_ADDR` and `NOMAD_TOKEN` are exported.
   Ask the user if missing. Never hardcode addresses or tokens.

1. **Run any API call**:
   ```bash
   nomad-ops <resource> <action> [args...]
   ```
   *Note: Both singular and plural resource names are supported (e.g., `job` or `jobs`).*

2. **Check resource status**:
   ```bash
   # 'status' is a universal alias for 'read'
   nomad-ops job status my-app
   nomad-ops node status node-1
   nomad-ops volume status my-vol
   ```

3. **Smart Volume Snapshots**:
   ```bash
   # Auto-looks up PluginID and Namespace from the volume status
   nomad-ops volume snapshot-create <vol_id> <snap_name>

   # Or specify manually
   nomad-ops volume snapshot-create <plugin_id> <vol_id> <snap_name>
   ```

4. **Submit a job** (HCL or JSON):
   ```bash
   nomad-ops jobs submit path/to/job.nomad
   nomad-ops jobs submit --json '{"Job":{...}}'
   ```

4. **Tail allocation logs**:
   ```bash
   nomad-ops alloc logs <alloc_id> <task> [--stderr]
   ```

## Invocation resolution

After `install.sh` runs once, `nomad-ops` is in `PATH` and self-resolves its
real location at runtime via `readlink`. No env vars, no CWD dependency.

**When `nomad-ops` is not found in `PATH`:**

Step 1 — discover and install. Do not proceed with raw paths if this succeeds:
```bash
SKILL=$(find ~ -name "nomad-client.ts" -maxdepth 8 2>/dev/null | head -1)
# SKILL → /some/path/nomad-ops-skill/scripts/nomad-client.ts
bash "$(dirname "$SKILL")/../install.sh"
# nomad-ops is now in PATH; use it for all subsequent commands
```

Step 2 — if install reports that `~/.local/bin` is not in `PATH`, inform the
user and ask them to add it to their shell profile, then re-run the command.

Step 3 — only if discovery finds nothing, ask the user where the skill is
installed. Never guess or hardcode paths.

## Runtime detection

`scripts/nomad` (the shim behind `nomad-ops`) provisions the Node.js runtime automatically:

| Condition | Behaviour |
|-----------|-----------|
| `node` (v24+) in `PATH` | executes directly via native `--experimental-transform-types` |
| `node` (v24+) absent, `npx` present | executes via `npx ts-node` |
| both absent, `nix-shell` present | provisions `jq nodejs_24 python312` transiently |
| neither available | exits with an actionable error |

No manual `nix-shell` invocation is needed on NixOS.

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NOMAD_ADDR` | Yes | `http://127.0.0.1:4646` | Cluster HTTP address |
| `NOMAD_TOKEN` | ACL only | — | `X-Nomad-Token` header |
| `NOMAD_NAMESPACE` | No | `default` | Target namespace |
| `NOMAD_REGION` | No | — | Target region |
| `NOMAD_CACERT` | TLS | — | CA certificate path |
| `NOMAD_CLIENT_CERT` | mTLS | — | Client certificate path |
| `NOMAD_CLIENT_KEY` | mTLS | — | Client key path |
| `NOMAD_TLS_SKIP_VERIFY` | No | `false` | Skip TLS verification |

## Optimization & Token Efficiency

This skill is optimized for agentic workflows where context window space is a premium. Use these flags to reduce token usage:

| Flag | Purpose | Example |
|---|---|---|
| `--filter <expr>` | **Best:** Server-side filtering (Nomad syntax). | `jobs list --filter 'Status == "running"'` |
| `--short` / `-s` | **Great:** Concise Markdown table of key fields. | `jobs list --short` |
| `--fields <list>` | Projection: Return only specific JSON fields. | `job read my-job --fields ID,Status` |
| `--limit <N>` | Limit results to N items (defaults to 50). | `allocs list --limit 10` |
| `--format <table>` | Force Markdown table output for any list. | `evals list --format table` |

## Resource Map (100% API Coverage)

### Jobs `/v1/job[s]`
| Action | Command |
|---|---|
| List jobs | `jobs list` |
| Submit / update | `jobs submit <file\|--json>` |
| Parse HCL→JSON | `jobs parse <file>` |
| Read job | `job read <id>` |
| Job submission src | `job submission <id> [--version N]` |
| List versions | `job versions <id> [--diffs]` |
| List allocations | `job allocations <id>` |
| List evaluations | `job evaluations <id>` |
| List deployments | `job deployments <id>` |
| Current deployment | `job deployment <id>` |
| Summary | `job summary <id>` |
| Update/register | `job update <id> <file>` |
| Dispatch parameterized | `job dispatch <id> [--meta k=v] [--payload file]` |
| Revert | `job revert <id> --version N` |
| Mark stable | `job stable <id> --version N` |
| Force evaluate | `job evaluate <id>` |
| Plan | `job plan <id> <file>` |
| Force periodic | `job periodic-force <id>` |
| Scale group | `job scale <id> --group <g> --count N` |
| Get scale status | `job scale-status <id>` |
| List services | `job services <id>` |
| List actions | `job actions <id>` |
| Run action (WS) | `job action <id> --action <a> --alloc <id> --task <t>` |
| Tag version | `job tag <id> --tag <name> --version N` |
| Delete version tag | `job untag <id> --tag <name>` |
| Stop / purge | `job stop <id> [--purge]` |

### Allocations `/v1/allocation[s]`
| Action | Command |
|---|---|
| List | `allocs list` |
| Health summary | `allocs health` |
| Read | `alloc read <id>` |
| Checks | `alloc checks <id>` |
| Services | `alloc services <id>` |
| Stop | `alloc stop <id>` |

### Client `/v1/client`
| Action | Command |
|---|---|
| Node stats | `client stats [id\|name]` |
| Alloc stats | `client alloc-stats <id>` |
| GC allocation | `client alloc-gc <id>` |
| Pause alloc | `client alloc-pause <id>` |
| Restart alloc | `client alloc-restart <id> [--task t]` |
| Signal alloc | `client alloc-signal <id> --signal SIGTERM [--task t]` |
| Exec into task | `client exec <id> <task> -- <cmd> [args]` |
| List files | `client fs ls <id> [path]` |
| Stat file | `client fs stat <id> <path>` |
| Read file | `client fs cat <id> <path>` |
| Read at offset | `client fs readat <id> <path> --offset N --limit N` |
| Stream file | `client fs stream <id> <path>` |
| Stream logs | `alloc logs <id> <task> [--stderr] [--tail N]` |
| GC client | `client gc` |
| Identity | `client identity` |
| Renew identity | `client identity-renew` |
| Node metadata | `client metadata` |

### Nodes `/v1/node[s]`
| Action | Command |
|---|---|
| List | `nodes list` |
| Resource usage | `nodes usage` |
| Cluster dashboard | `nodes dashboard` |
| Cluster inventory | `nodes inventory` |
| Real-time stats | `nodes stats` |
| Cluster topography | `nodes topography` |
| Read | `node read <id>` |
| Allocations | `node allocations <id>` |
| Force evaluate | `node evaluate <id>` |
| Drain | `node drain <id> --enable\|--disable [--deadline Xm]` |
| Purge | `node purge <id>` |
| Eligibility | `node eligibility <id> --enable\|--disable` |

### Deployments `/v1/deployment[s]`
| Action | Command |
|---|---|
| List | `deployments list` |
| Read | `deployment read <id>` |
| List allocations | `deployment allocations <id>` |
| Pause / resume | `deployment pause <id>` / `deployment resume <id>` |
| Promote | `deployment promote <id> [--group g]` |
| Fail | `deployment fail <id>` |
| Unblock | `deployment unblock <id>` |
| Alloc health | `deployment alloc-health <id>` |

### Evaluations `/v1/evaluation[s]`
| Action | Command |
|---|---|
| List | `evals list` |
| Count | `evals count` |
| Read | `eval read <id>` |
| Allocations | `eval allocations <id>` |
| Delete batch | `evals delete --ids id1,id2` |

### Volumes & Storage `/v1/volume[s]`
**CSI Volumes** — first-class:
| Action | Command |
|---|---|
| List all volumes | `volumes list [--type csi\|host] [--plugin P] [--node N]` |
| Read volume | `volume status <id>` / `volume csi-read <id>` |
| Register CSI volume | `volume csi-register <id> <json_file>` |
| Create CSI volume | `volume csi-create <id> <json_file>` |
| Deregister | `volume csi-deregister <id> [--force]` |
| Delete volume | `volume csi-delete <id> [--secret k=v]` |
| Detach | `volume csi-detach <id> --node <node_id>` |
| List external | `volume external-list <plugin_id>` |
| List snapshots | `volume snapshot-list <plugin_id>` |
| Create snapshot | `volume snapshot-create [plugin_id] <vol_id> <snap_name> [--param k=v] [--secret k=v]` |
| Delete snapshot | `volume snapshot-delete <plugin_id> <snapshot_id> [--secret k=v]` |
| Delete claim | `volume claim-delete <claim_id>` |

> **Note:** `csi-register` and `csi-create` currently require a JSON payload. However, `snapshot-create` supports either a JSON blob or positional arguments. When using positional arguments, if `plugin_id` is omitted, the skill will automatically look it up by checking the volume's status. You can pass multiple `--param key=value` and `--secret key=value` flags as needed.

**Dynamic Host Volumes**:
| Action | Command |
|---|---|
| Read host volume | `volume host-read <id>` |
| Register host volume | `volume host-register <id> <file>` |
| Create host volume | `volume host-create <id> <file>` |
| Delete host volume | `volume host-delete <id>` |

### Plugins `/v1/plugin[s]`
| Action | Command |
|---|---|
| List plugins | `plugins list` |
| Read CSI plugin | `plugin csi-read <plugin_id>` |

### Services `/v1/service[s]`
| Action | Command |
|---|---|
| List | `services list` |
| Read by name | `service read <name>` |
| Delete instance | `service delete <name> <service_id>` |

### Variables `/v1/var[s]`
| Action | Command |
|---|---|
| List | `vars list [path-prefix]` |
| Read | `var read <path>` |
| Write / upsert | `var write <path> <file\|--kv k=v>` |
| Delete | `var delete <path>` |
| Lock acquire | `var lock-acquire <path> <file>` |
| Lock renew | `var lock-renew <path> --lock-id L` |
| Lock release | `var lock-release <path> --lock-id L` |

### Scaling Policies `/v1/scaling`
| Action | Command |
|---|---|
| List | `scaling list` |
| Read | `scaling read <id>` |

### Namespaces `/v1/namespace[s]`
| Action | Command |
|---|---|
| List | `namespaces list` |
| Read | `namespace read <name>` |
| Create / update | `namespace write <name> <file\|--desc text>` |
| Delete | `namespace delete <name>` |

### Node Pools `/v1/node/pool[s]`
| Action | Command |
|---|---|
| List | `node-pools list` |
| Read | `node-pool read <name>` |
| Create / update | `node-pool write <name> <file>` |
| Delete | `node-pool delete <name>` |
| List nodes in pool | `node-pool nodes <name>` |
| List jobs in pool | `node-pool jobs <name>` |

### ACL `/v1/acl`
| Action | Command |
|---|---|
| Bootstrap | `acl bootstrap` |
| List tokens | `acl tokens` |
| Create token | `acl token-create <file>` |
| Update token | `acl token-update <accessor_id> <file>` |
| Read token | `acl token-read <accessor_id>` |
| Self token | `acl token-self` |
| Delete token | `acl token-delete <accessor_id>` |
| One-time token | `acl token-onetime` |
| Exchange OTT | `acl token-ott-exchange <ott>` |
| List policies | `acl policies` |
| Write policy | `acl policy-write <name> <file>` |
| Read policy | `acl policy-read <name>` |
| Self policy | `acl policy-self` |
| Delete policy | `acl policy-delete <name>` |
| List roles | `acl roles` |
| Create role | `acl role-create <file>` |
| Update role | `acl role-update <id> <file>` |
| Read role by ID | `acl role-read <id>` |
| Read role by name | `acl role-read-name <name>` |
| Delete role | `acl role-delete <id>` |
| List auth methods | `acl auth-methods` |
| Create auth method | `acl auth-method-create <file>` |
| Update auth method | `acl auth-method-update <name> <file>` |
| Read auth method | `acl auth-method-read <name>` |
| Delete auth method | `acl auth-method-delete <name>` |
| List binding rules | `acl binding-rules` |
| Create binding rule | `acl binding-rule-create <file>` |
| Update binding rule | `acl binding-rule-update <id> <file>` |
| Read binding rule | `acl binding-rule-read <id>` |
| Delete binding rule | `acl binding-rule-delete <id>` |
| OIDC auth URL | `acl oidc-auth-url <file>` |
| OIDC complete auth | `acl oidc-complete-auth <file>` |
| ACL login | `acl login <file>` |
| Client intro token | `acl identity-token` |
| JWKS | `acl jwks` |
| OIDC config | `acl oidc-config` |

### Quotas `/v1/quota[s]` (Enterprise)
| Action | Command |
|---|---|
| List | `quotas list` |
| List usages | `quotas usages` |
| Read | `quota read <name>` |
| Usage | `quota usage <name>` |
| Create / update | `quota write <name> <file>` |
| Delete | `quota delete <name>` |

### Sentinel Policies `/v1/sentinel` (Enterprise)
| Action | Command |
|---|---|
| List | `sentinel list` |
| Write | `sentinel write <name> <file>` |
| Read | `sentinel read <name>` |
| Delete | `sentinel delete <name>` |

### Recommendations `/v1/recommendation[s]` (Enterprise)
| Action | Command |
|---|---|
| List | `recommendations list` |
| Read | `recommendation read <id>` |
| Create | `recommendation create <file>` |
| Apply | `recommendations apply <file>` |

### Operator `/v1/operator`
| Action | Command |
|---|---|
| Raft config | `operator raft-config` |
| Remove raft peer | `operator raft-remove-peer --address A\|--id I` |
| Transfer leadership | `operator raft-transfer-leadership [--id I]` |
| Autopilot config | `operator autopilot-config` |
| Set autopilot | `operator autopilot-set <file>` |
| Autopilot health | `operator autopilot-health` |
| Scheduler config | `operator scheduler-config` |
| Set scheduler | `operator scheduler-set <file>` |
| List keyring keys | `operator keyring-keys` |
| Rotate keyring | `operator keyring-rotate [--full]` |
| Delete keyring key | `operator keyring-delete <key_id>` |
| Get license | `operator license` |
| Get snapshot | `operator snapshot-save <output_file>` |
| Restore snapshot | `operator snapshot-restore <input_file>` |
| Vault upgrade check | `operator upgrade-check-vault` |
| Utilization report | `operator utilization <file>` |

### Agent `/v1/agent`
| Action | Command |
|---|---|
| Self info | `agent self` |
| Members | `agent members` |
| Servers | `agent servers` |
| Health | `agent health` |
| Host info | `agent host` |
| Join | `agent join --address A` |
| Force leave | `agent force-leave --node N` |
| Monitor (stream) | `agent monitor [--log-level debug]` |
| Profiling | `agent pprof --type profile\|trace\|goroutine\|cmdline` |
| Scheduler config | `agent scheduler-config` |
| Set schedulers | `agent scheduler-set <file>` |

### Misc
| Action | Command |
|---|---|
| List regions | `regions` |
| Status: leader | `status leader` |
| Status: peers | `status peers` |
| GC | `system gc` |
| Reconcile summaries | `system reconcile-summaries` |
| Metrics | `metrics [--format prometheus]` |
| Search | `search --prefix <text> [--context job\|node\|...]` |
| Fuzzy search | `search fuzzy --text <text>` |
| Validate job | `validate <file>` |
| Event stream | `events stream [--topic T] [--index N]` |

## Job Spec First-Class Features

### Template Stanza
Nomad templates use Go `text/template` with Consul Template functions.
When the user asks about templates, refer to `references/job-spec.md`.

Key template functions:
- `{{ key "path" }}` — Consul KV
- `{{ secret "path" }}` — Vault secret
- `{{ env "VAR" }}` — environment variable
- `{{ file "path" }}` — file contents
- `{{ with secret }}...{{ end }}` — Vault dynamic secrets
- `{{ range service "name" }}...{{ end }}` — service discovery

### Artifact Stanza
Downloads files before task starts. Supports `http`, `https`, `git`, `s3`.
```hcl
artifact {
  source      = "https://example.com/app-${NOMAD_TASK_NAME}.tar.gz"
  destination = "local/"
  options { checksum = "sha256:abc123" }
}
```

### CSI Volume in Job Spec
```hcl
volume "data" {
  type            = "csi"
  source          = "my-volume"
  read_only       = false
  attachment_mode = "file-system"
  access_mode     = "single-node-writer"
  mount_options { fs_type = "ext4" }
}
```

### Service Discovery
```hcl
service {
  name     = "my-app"
  port     = "http"
  provider = "consul"  # or "nomad"
  tags     = ["urlprefix-/app"]
  check {
    type     = "http"
    path     = "/health"
    interval = "10s"
    timeout  = "2s"
  }
}
```

## Workflow Examples

### Deploy a job
```bash
# 1. Validate first
nomad-ops validate my-job.nomad
# 2. Plan
nomad-ops job plan my-job my-job.nomad
# 3. Submit
nomad-ops jobs submit my-job.nomad
```

### Scale a job group
```bash
nomad-ops job scale my-job --group web --count 5 --message "Scaling up for traffic"
```

### Watch deployment
```bash
nomad-ops deployment read <deploy_id>
```

### Register and use a CSI volume
```bash
# 1. Register
nomad-ops volume csi-register my-vol volumes/my-vol.json
# 2. Verify
nomad-ops volume csi-read my-vol
```

### Drain a node
```bash
nomad-ops node drain <node_id> --enable --deadline 10m
```

## Error Handling

The TypeScript client throws `NomadApiError` with:
- `statusCode`: HTTP status code
- `message`: error body from Nomad
- `endpoint`: the URL that failed

Always check for `403` (ACL permission denied), `404` (not found), and `500` (server error).

## References

See `references/job-spec.md` for complete HCL job specification with all stanzas.
See `references/csi-volumes.md` for CSI volume spec details.
See `references/api-patterns.md` for blocking queries, filtering, and pagination.
