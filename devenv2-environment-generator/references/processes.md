# Process Manager Reference (devenv 2.x Native)

The built-in Rust process manager is the default since devenv 2.0.
`process-compose` remains available via `process.manager.implementation = "process-compose"`.
Other alternatives: `"overmind"`, `"honcho"`, `"hivemind"`, `"mprocs"`.
Sibling references: `tasks.md` (every process is also a task), `scripts-and-files.md`.

## Port allocation — required for agent parallelism

Always use `ports.<port-name>.allocate`. Hardcoded port strings will collide when multiple
agents or developers run the same environment concurrently.

```nix
processes.api = {
  exec = "uvicorn app.main:app --port ${toString config.processes.api.ports.http.value}";
  ports.http.allocate = 8000;   # base port; increments until a free one is found
};
```

`ports.<port-name>.value` is read-only and resolved at evaluation time — read it with
`config.processes.<name>.ports.<port-name>.value`, never by shelling out to `devenv eval`.

Use `devenv up --strict-ports` to fail instead of searching for an available port
(`--no-strict-ports` to override). The default lives in `devenv.yaml`:

```yaml
strict_ports: true
```

## Dependency ordering

```nix
# Wait for service readiness probe (@ready is the default for processes)
after = [ "devenv:processes:postgres" ];

# Wait for a one-shot process to exit cleanly
after = [ "devenv:processes:migrate@completed" ];

# Wait only for the process to start (not ready)
after = [ "devenv:processes:postgres@started" ];

# Reverse dependency — declare that other processes depend on this one
before = [ "devenv:processes:api" ];
```

Dependency suffixes for processes: `@started`, `@ready` (default), `@completed`.
Dependency suffixes for tasks: `@started`, `@succeeded` (default), `@completed`.
`@completed` is a soft dependency — failure does not propagate.

Processes and tasks can be freely mixed in dependency chains. See `tasks.md`.

## Readiness probes

```nix
# HTTP probe
ready.http.get = {
  port = config.processes.api.ports.http.value;
  path = "/healthz";
  # host = "127.0.0.1";   # default
  # scheme = "http";       # default
};

# Exec probe — exit 0 means ready
ready.exec = "pg_isready -h 127.0.0.1";

# systemd notify (process sends READY=1 to $NOTIFY_SOCKET)
ready.notify = true;
```

When `listen` sockets or allocated ports are configured and no explicit probe is set,
a TCP connectivity check is used automatically.

### Probe tuning

```nix
ready = {
  http.get = { port = 8080; path = "/health"; };
  initial_delay = 0;       # seconds before first probe
  period = 10;             # seconds between probes
  probe_timeout = 1;       # single probe timeout in seconds
  timeout = null;          # overall deadline (null = no limit)
  success_threshold = 1;   # consecutive successes needed
  failure_threshold = 3;   # consecutive failures before unhealthy
};
```

## Restart policies

```nix
processes.worker = {
  exec = "python worker.py";
  restart.on = "on_failure";   # "never" | "always" | "on_failure" (default: "on_failure")
  restart.max = 5;             # max restarts; null for unlimited (default: 5)
  restart.window = null;       # sliding window in seconds; null = lifetime limit
};
```

## File watching

```nix
processes.api = {
  exec = "cargo run";
  watch.paths = [ ./src ./migrations ];
  watch.extensions = [ "rs" "toml" ];
  watch.ignore = [ "target" "*.log" ];
};
```

`watch.paths` entries resolve relative to the directory holding `devenv.nix`, not to `cwd`.
Use path literals (`./src`), not strings.

Since 2.2 `watch` also covers one-shot commands: a long-running process is restarted on
each change, while a command that exits immediately is parked and re-run on the next change.

```nix
processes.on-change = {
  exec = "echo 'a file in ./src changed'";
  watch.paths = [ ./src ];
};
```

## Per-process environment and working directory

```nix
processes.api = {
  exec = "uvicorn app:app";
  env = { PYTHONPATH = "./src"; };     # attrset of strings
  cwd = "${config.git.root}/backend";  # config.git.root helps in monorepos
};
```

## Auto-start control

```nix
processes.debug-server = {
  exec = "dlv debug ./cmd/server";
  start.enable = false;   # visible in the TUI but not started by a bare `devenv up`
};
```

A process with `start.enable = false` still starts when named explicitly:
`devenv up debug-server` or `devenv processes start debug-server`.

## One-shot processes (migrations, seed data)

```nix
processes.migrate = {
  exec = "alembic upgrade head";
  # A clean exit is never restarted. The default restart.on = "on_failure" still applies,
  # so a failing one-shot retries up to restart.max; set restart.on = "never" to opt out.
};

processes.api = {
  after = [
    "devenv:processes:postgres"
    "devenv:processes:migrate@completed"
  ];
};
```

## Socket activation

```nix
processes.api = {
  exec = "./api-server";
  listen = [{
    name = "http";
    kind = "tcp";            # or "unix_stream"
    address = "127.0.0.1:8080";
    # backlog = 128;         # default
  }];
};
```

For Unix sockets:
```nix
listen = [{
  name = "admin";
  kind = "unix_stream";
  path = "$DEVENV_STATE/admin.sock";
  # mode = 384;             # octal 0o600
}];
```

The process receives `LISTEN_FDS`, `LISTEN_PID` and `LISTEN_FDNAMES`; descriptors start at 3
(systemd-compatible).

## Watchdog heartbeats

```nix
processes.daemon = {
  exec = "./daemon";
  ready.notify = true;
  watchdog.usec = 30000000;       # 30s in microseconds
  watchdog.require_ready = true;  # default — only enforce after READY=1
};
```

## Linux capabilities

```nix
processes.server = {
  exec = "./server --port 80";
  linux.capabilities = [ "net_bind_service" ];
};
```

## 2.2 attach lifecycle

```bash
devenv up -d            # start the process manager in the background
devenv up               # attach to it: live status, ports and logs over the control socket
devenv processes attach # attach without starting anything (native manager only)
devenv down             # shorthand for `devenv processes down`
```

A second `devenv up` no longer fails when a manager is already running: it attaches, starts
any enabled-but-not-running processes honoring `after`/`before`, and streams a live view.
Ctrl-C prompts to detach (leaving processes running) rather than stopping them. The attached
session is non-interactive — stdin is not wired to the processes, though the TUI
restart/stop keybindings still work. It exits nonzero when nothing could be started.

`devenv up <name>` and `devenv processes start <name>` share one dependency-aware launch path:

- Named processes start even when `start.enable = false`; a bare `devenv up` starts only
  processes with `start.enable = true`.
- If a dependency is not running, the named process waits for it instead of starting without it.
- If no manager is running, `devenv processes start <name>` cold-boots one in the background
  running just that process — equivalent to `devenv up -d <name>`.

Attach schedules into the configuration the running manager was started with. Edits to
`devenv.nix` are not picked up, and names outside the running process set are rejected.
Restart to pick up changes: `devenv processes down && devenv up -d`.

Under AI agents and non-TTY/piped output devenv never blocks on attach — it reports what is
already running and returns.

`devenv up` schedules processes in `before` mode, which runs each process's upstream
dependencies but not tasks downstream of it. A setup task wired with
`processes.<name>.before = [ "<namespace>:configure" ]` is therefore skipped; run
`devenv up --mode all` to include it. `devenv test` already runs in `all` mode.

## Process management CLI

```bash
devenv up [-d] [<name>...]         # start (optionally detached), or attach if already running
devenv up --mode all               # include downstream setup tasks
devenv down                        # stop background processes
devenv processes attach            # live view of a running manager (native only)
devenv processes wait --timeout 120  # block until all processes are ready (default 120s)
devenv processes list              # list all managed processes and their status
devenv processes status <name>     # status of one process
devenv processes logs <name>       # stream process logs
devenv processes restart <name>    # restart a process
devenv processes start [<name>]    # start a process honoring dependencies (all if omitted)
devenv processes stop [<name>]     # stop a process (all if omitted)
```

## Migrating from process-compose

Translate `processes.<name>.process-compose` attributes to native equivalents.

| process-compose | Native |
| --- | --- |
| `depends_on.X.condition = "process_started"` | `after = [ "devenv:processes:X@started" ]` |
| `depends_on.X.condition = "process_healthy"` | `after = [ "devenv:processes:X" ]` (`@ready` default; X needs a probe) |
| `depends_on.X.condition = "process_completed_successfully"` | `after = [ "devenv:processes:X@succeeded" ]` |
| `depends_on.X.condition = "process_completed"` | `after = [ "devenv:processes:X@completed" ]` |
| `availability.restart` | `restart.on` |
| `availability.max_restarts` | `restart.max` (plus `restart.window` for rate limiting) |
| `availability.backoff_seconds` | no equivalent — the native manager restarts immediately |
| `environment = [ "K=V" ]` | `env = { K = "V"; }` (attrset of strings) |
| `working_dir` | `cwd` |
| `readiness_probe.exec.command` | `ready.exec` |
| `readiness_probe.period_seconds` | `ready.period` |
| `liveness_probe` | `ready.notify = true` + `watchdog.{usec,require_ready}` |
| `is_elevated = true` | `linux.capabilities = [ ... ]` |
| `shutdown.signal` | trap the signal inside `exec` and forward it yourself |

Forwarding a non-SIGTERM shutdown signal:

```nix
processes.postgres.exec = ''
  trap 'kill -INT "$PID"' TERM
  postgres -D "$PGDATA" &
  PID=$!
  wait "$PID"
'';
```

https://devenv.sh/processes/
https://devenv.sh/guides/migrating-to-2.0/
