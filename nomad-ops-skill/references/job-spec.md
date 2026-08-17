# Nomad Job Specification Reference

All stanzas below map 1-to-1 to their JSON API equivalents via
`/v1/jobs/parse`. Keys are HCL in documentation; JSON equivalents are
PascalCase (e.g. `task_groups` → `TaskGroups`).

---

## Top-Level `job` Stanza

```hcl
job "<id>" {
  type        = "service" # service | batch | sysbatch | system | cron
  namespace   = "default"
  region      = "global"
  priority    = 50         # 1-100; higher wins preemption
  datacenters = ["dc1"]
  node_pool   = "default"
  all_at_once = false

  meta { key = "value" }   # arbitrary k/v; accessible as env NOMAD_META_*

  constraint { ... }       # see Placement section
  affinity   { ... }
  spread     { ... }

  vault   { ... }          # cluster-wide Vault defaults
  consul  { ... }          # cluster-wide Consul defaults

  reschedule {             # applies to batch; service uses update{}
    attempts       = 3
    interval       = "24h"
    delay          = "30s"
    delay_function = "exponential"  # constant | linear | exponential
    max_delay      = "1h"
    unlimited      = false
  }

  migrate {
    max_parallel     = 1
    health_check     = "checks" # checks | task_states
    min_healthy_time = "10s"
    healthy_deadline = "5m"
  }

  update {                 # rolling update strategy
    max_parallel      = 1
    health_check      = "checks"
    min_healthy_time  = "10s"
    healthy_deadline  = "5m"
    progress_deadline = "10m"
    canary            = 0
    auto_revert       = true
    auto_promote      = false
    stagger           = "30s"
  }

  group "<name>" { ... }   # one or more
}
```

---

## `group` Stanza

```hcl
group "<name>" {
  count = 1
  meta  { ... }

  constraint { ... }
  affinity   { ... }
  spread     { ... }

  network { ... }          # see Network section
  service { ... }          # see Service Discovery section
  volume  "<name>" { ... } # see Volume section

  restart {
    attempts = 3
    interval = "5m"
    delay    = "15s"
    mode     = "fail"  # fail | delay | on_success
  }

  reschedule { ... }       # override job-level

  ephemeral_disk {
    size    = 300   # MB
    sticky  = false # retain data across reschedules on same node
    migrate = false # copy data to new alloc on reschedule
  }

  scaling {
    min     = 1
    max     = 10
    enabled = true
    policy  { ... }  # external autoscaler policy
  }

  stop_after_client_disconnect = "1h"
  max_client_disconnect        = "6h"
  prevent_reschedule_on_lost   = false

  task "<name>" { ... }    # one or more
}
```

---

## `task` Stanza

```hcl
task "<name>" {
  driver = "docker"  # docker | exec | raw_exec | java | qemu | ...
  config { ... }     # driver-specific; see driver docs

  env   { KEY = "value" }
  meta  { ... }
  user  = ""

  resources {
    cpu        = 500   # MHz; or use cores=
    cores      = 0     # reserved CPU cores (requires CpuTotalCompute)
    memory     = 256   # MB
    memory_max = 512   # soft limit with oversubscription

    network {
      mbits = 10
      mode  = "bridge" # none | bridge | host | cni/<name>
      dns   { servers = ["1.1.1.1"] }
      port "http" { static = 8080; to = 8080; host_network = "public" }
      port "grpc" { to = 9090 }   # dynamic host port
    }

    device "nvidia/gpu" {
      count       = 1
      constraint  { attribute = "${device.attr.memory}" value = "16384" }
    }
  }

  numa {
    affinity = "require"  # none | prefer | require | unique
  }

  volume_mount {
    volume      = "<group-volume-name>"
    destination = "/data"
    read_only   = false
    propagation_mode = "private" # private | host-to-task | bidirectional
  }

  # ── Vault integration ───────────────────────────────────────────────────
  vault {
    role        = ""
    policies    = ["app-policy"]
    change_mode = "restart"  # noop | restart | signal
    change_signal = "SIGHUP"
    env         = true
    disable_file = false
  }

  # ── Identity (workload identity) ────────────────────────────────────────
  identity {
    name          = "default"
    aud           = ["consul.io"]
    env           = true
    file          = true
    change_mode   = "restart"
    change_signal = "SIGHUP"
    ttl           = "1h"
  }

  # ── Service discovery ───────────────────────────────────────────────────
  service { ... }    # see Service Discovery section

  # ── Templates ───────────────────────────────────────────────────────────
  template { ... }   # see Template section

  # ── Artifacts ───────────────────────────────────────────────────────────
  artifact { ... }   # see Artifact section

  # ── Lifecycle ───────────────────────────────────────────────────────────
  lifecycle {
    hook    = "prestart"  # prestart | poststart | poststop
    sidecar = false       # true = runs for alloc lifetime
  }

  # ── Dispatch payload ────────────────────────────────────────────────────
  dispatch_payload { file = "payload.json" }

  # ── Restart on change ───────────────────────────────────────────────────
  restart { ... }

  logs {
    max_files     = 10
    max_file_size = 10  # MB
    disabled      = false
  }

  kill_timeout = "5s"
  kill_signal  = "SIGTERM"
  shutdown_delay = "0s"
}
```

---

## Network (`network`) Stanza

```hcl
network {
  mode  = "bridge"
  mbits = 10

  dns {
    servers  = ["1.1.1.1", "8.8.8.8"]
    searches = ["consul"]
    options  = ["ndots:1"]
  }

  # Static port — same port on host as in container
  port "db" {
    static       = 5432
    to           = 5432
    host_network = "default"
  }

  # Dynamic port — Nomad picks a free host port; maps to container port
  port "http" { to = 8080 }
}
```

Ports are injected as `NOMAD_PORT_<label>` and `NOMAD_ADDR_<label>`.

---

## Placement: `constraint`, `affinity`, `spread`

```hcl
# Hard constraint — required
constraint {
  attribute = "${attr.kernel.name}"  # or ${node.class}, ${meta.*}, etc.
  operator  = "="   # = | != | > | >= | < | <= | regexp | set_contains | ...
  value     = "linux"
}

# Soft preference — scored, not filtered
affinity {
  attribute = "${node.datacenter}"
  operator  = "="
  value     = "us-east-1a"
  weight    = 100  # -100 to 100
}

# Spread allocations across attribute values
spread {
  attribute = "${node.datacenter}"
  weight    = 100
  target "us-east-1a" { percent = 60 }
  target "us-east-1b" { percent = 40 }
}
```

**Common attribute selectors**

| Attribute                  | Example value          |
|----------------------------|------------------------|
| `${attr.kernel.name}`      | `linux`                |
| `${attr.cpu.arch}`         | `amd64`                |
| `${attr.driver.docker}`    | `1`                    |
| `${node.class}`            | `compute`              |
| `${node.datacenter}`       | `dc1`                  |
| `${node.pool}`             | `prod`                 |
| `${meta.<key>}`            | user-defined node meta |

---

## Template Stanza (Go text/template + Consul Template)

```hcl
template {
  source      = ""                       # local path relative to alloc dir
  destination = "local/config.env"       # destination inside alloc dir
  data        = <<EOT
{{ range service "redis" }}
REDIS_ADDR={{ .Address }}:{{ .Port }}
{{ end }}
DB_PASS={{ with secret "secret/data/myapp" }}{{ .Data.data.password }}{{ end }}
EOT

  change_mode   = "restart"  # noop | restart | signal
  change_signal = "SIGHUP"
  env           = false       # true → parse file as KEY=VALUE and inject into env
  left_delimiter  = "{{"
  right_delimiter = "}}"
  perms           = "0644"
  uid             = -1
  gid             = -1
  wait { min = "2s"; max = "10s" }       # debounce before rendering
  error_on_missing_key = false
}
```

### Key Consul Template functions

| Function | Description |
|----------|-------------|
| `{{ key "path" }}` | Read a Consul KV key |
| `{{ keyOrDefault "path" "fallback" }}` | KV with default |
| `{{ secret "secret/data/name" }}` | Read a Vault KV v2 secret |
| `{{ with secret "..." }}{{ .Data.data.key }}{{ end }}` | Safe secret access |
| `{{ range service "name" }}` | Iterate healthy service instances |
| `{{ range services }}` | Iterate all services |
| `{{ env "VAR" }}` | Read an environment variable |
| `{{ file "path" }}` | Read a file |
| `{{ base64Encode "str" }}` / `{{ base64Decode "str" }}` | Encoding helpers |
| `{{ sockaddr "GetPrivateIP" }}` | Network address helpers |
| `{{ timestamp }}` | Current Unix timestamp |
| `{{ plugin "name" "arg" }}` | Invoke a Consul Template plugin |

### Common data paths in templates

```
${NOMAD_ALLOC_DIR}     — /alloc           (shared across tasks in group)
${NOMAD_TASK_DIR}      — /local           (task-private)
${NOMAD_SECRETS_DIR}   — /secrets         (task-private; 700; in-memory tmpfs)
${NOMAD_PORT_<label>}  — dynamic host port
${NOMAD_ADDR_<label>}  — host:port combo
${NOMAD_JOB_ID}        — job identifier
${NOMAD_ALLOC_ID}      — allocation UUID
${NOMAD_TASK_NAME}     — task name
${NOMAD_NAMESPACE}     — namespace
${NOMAD_DC}            — datacenter
```

---

## Artifact Stanza

```hcl
artifact {
  source      = "https://releases.example.com/app-${NOMAD_META_version}.tar.gz"
  destination = "local/"   # relative to alloc dir; default: "local/"
  mode        = "any"      # any | file | dir
  options {
    # go-getter options (checksum, archive format, etc.)
    checksum = "sha256:abc123..."
    archive  = "true"       # auto-detected by default
  }
  headers {
    Authorization = "Bearer ${VAULT_TOKEN}"
  }
}
```

**Supported `source` URL schemes** (via `go-getter`):

| Scheme | Example |
|--------|---------|
| `https://` / `http://` | Web server / S3 presigned |
| `s3::https://` | S3 bucket |
| `gcs::https://` | GCS bucket |
| `git::https://` | Git repository |
| `hg::https://` | Mercurial |
| `file://` | Local filesystem (for dev) |

Multiple `artifact` blocks are allowed and downloaded in parallel.

---

## Service Discovery Stanza

Registerable at group-level (Consul Connect) or task-level (direct port).

```hcl
service {
  name     = "${NOMAD_JOB_ID}-api"  # interpolation supported
  port     = "http"                  # matches a network port label
  tags     = ["v2", "primary"]
  provider = "consul"                # consul (default) | nomad

  address  = ""       # override; default = task/alloc IP
  address_mode = "auto" # auto | driver | alloc | host

  meta { version = "2.1.0" }        # Consul service metadata

  # Health checks
  check {
    name     = "http-alive"
    type     = "http"               # http | tcp | script | grpc
    path     = "/health"
    interval = "10s"
    timeout  = "2s"
    method   = "GET"
    header   { Accept = ["application/json"] }

    # On-fail restart (requires check restarts enabled on client)
    check_restart {
      limit           = 3
      grace           = "30s"
      ignore_warnings = false
    }
  }

  check {
    type     = "tcp"
    interval = "30s"
    timeout  = "5s"
  }

  # Consul Connect (service mesh)
  connect {
    sidecar_service {
      proxy {
        upstreams {
          destination_name = "redis"
          local_bind_port  = 6379
        }
        config {
          protocol = "http"
        }
      }
    }
    sidecar_task { resources { cpu = 100; memory = 64 } }
  }
}
```

**Provider = `nomad`** — registers with Nomad's built-in service catalog
(no Consul required). Supports `check` blocks with `type = "http"` or
`type = "tcp"` only.

---

## Volume Stanza (group-level)

Declares volumes used by tasks in the group. See `csi-volumes.md` for
provisioning details.

```hcl
# CSI volume
volume "data" {
  type            = "csi"
  source          = "my-volume-id"   # matches volume registered in Nomad
  read_only       = false
  attachment_mode = "file-system"    # file-system | block-device
  access_mode     = "single-node-writer"
  per_alloc       = false            # true = separate volume per alloc

  mount_options {
    fs_type     = "ext4"
    mount_flags = ["noatime"]
  }
}

# Host volume
volume "logs" {
  type      = "host"
  source    = "host-volume-name"     # matches host_volume on client config
  read_only = false
}
```

Tasks mount volumes via `volume_mount` (see Task stanza above).

---

## Scaling Stanza

```hcl
group "web" {
  scaling {
    min     = 2
    max     = 20
    enabled = true

    policy {
      cooldown            = "2m"
      evaluation_interval = "30s"

      check "avg-cpu" {
        source = "prometheus"
        query  = "avg(nomad_client_allocs_cpu_total_ticks{job='web'})"
        strategy "target-value" {
          target = 70
        }
      }
    }
  }
  # ...
}
```

Scale immediately via the API:
```ts
await nomad.jobs.scale(jobId, {
  Count: 5, Target: { Group: "web" }, Message: "manual scale up"
});
```

---

## Dispatch Job (Parameterized)

```hcl
job "image-processor" {
  type = "batch"

  parameterized {
    payload       = "required"   # forbidden | optional | required
    meta_required = ["image_url"]
    meta_optional = ["quality"]
  }

  group "process" {
    task "convert" {
      driver = "docker"
      config { image = "imagemagick:7" }
      dispatch_payload { file = "image.bin" }
      env { QUALITY = "${NOMAD_META_quality}" }
    }
  }
}
```

Dispatch an instance:
```ts
await nomad.jobs.dispatch(jobId, {
  Meta: { image_url: "s3://bucket/image.jpg" },
  Payload: Buffer.from(rawBytes).toString("base64"),
});
```

---

## Periodic Job

```hcl
job "nightly-report" {
  type = "batch"

  periodic {
    cron             = "0 2 * * *"   # standard 5-field cron
    time_zone        = "America/New_York"
    prohibit_overlap = true
  }

  group "report" { ... }
}
```

Force immediate run:
```ts
await nomad.jobs.periodicForce(jobId);
```

---

## Job Actions (v1.7+)

```hcl
task "api" {
  action "reload-config" {
    command = "/bin/reload.sh"
    args    = ["--graceful"]
  }
}
```

Invoke via WebSocket: `GET /v1/job/:id/action?action=reload-config&...`
