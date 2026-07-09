# Process Manager Reference (devenv 2.0 Native)

The built-in Rust process manager is the default in devenv 2.0.
`process-compose` remains available via `process.manager.implementation = "process-compose"`.

## Port allocation — required for agent parallelism

Always use `ports.<n>.allocate`. Hardcoded port strings will collide when multiple
agents or developers run the same environment concurrently.

```nix
processes.api = {
  exec = "uvicorn app.main:app --port ${toString config.processes.api.ports.http.value}";
  ports.http.allocate = 8000;   # preferred; finds next free if taken
};
```

Use `devenv up --strict-ports` to fail instead of searching for an available port.

## Dependency ordering

```nix
# Wait for service readiness probe (@ready is the default)
after = [ "devenv:processes:postgres" ];

# Wait for a one-shot process to exit cleanly
after = [ "devenv:processes:migrate@completed" ];
```

Processes and tasks can be freely mixed in dependency chains.

## Readiness probes

```nix
# HTTP probe
ready.http.get = {
  port = config.processes.api.ports.http.value;
  path = "/healthz";
};

# Exec probe
ready.exec = "pg_isready -h 127.0.0.1";

# systemd notify (process calls sd_notify)
ready.systemd-notify = true;
```

## Restart policies

```nix
processes.worker = {
  exec = "python worker.py";
  restart = "on-failure";   # "always" | "on-failure" | "never"
  restartDelay = 2;         # seconds between restarts
};
```

## File watching

```nix
processes.api = {
  exec = "cargo run";
  watch = [ "./src" "./migrations" "Cargo.toml" ];
};
```

## One-shot processes (migrations, seed data)

```nix
processes.migrate = {
  exec = "alembic upgrade head";
  # No restart policy — run once and exit
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
  exec = "systemd-socket-activate -l 8080 -- ./api";
  socketActivation = true;
};
```

## Watchdog heartbeats

```nix
processes.daemon = {
  exec = "./daemon";
  watchdog.usec = 30000000;   # 30s in microseconds
};
```

## Full reference

https://devenv.sh/processes/
