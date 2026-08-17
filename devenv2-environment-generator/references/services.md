# Service Configuration Reference

`services.*` modules for the datastores and infrastructure this skill wires up most often, how
each one turns into a managed process, and the canonical way to read a service's allocated port
back into your application config. Option paths were confirmed against
https://devenv.sh/reference/options/ for devenv 2.2.1.

## PostgreSQL

```nix
services.postgres = {
  enable = true;
  package = pkgs.postgresql_16;      # default pkgs.postgresql
  port = 5432;                       # base port for allocation, not necessarily the final one
  listen_addresses = "127.0.0.1";    # default ""  => unix socket only, no TCP port allocated
  initialDatabases = [{
    name = "myapp";
    user = "myapp";                  # creates the role and makes it the database owner
    pass = "devpass";                # requires user; dev-only, never a real credential
    # schema = ./schema.sql;         # absolute path, applied on first init
    # initialSQL = "CREATE EXTENSION IF NOT EXISTS pg_uuidv7;";
  }];
  # createDatabase = true;           # default true; only applies when initialDatabases == [ ]
  # initialScript = "CREATE ROLE readonly;";   # server-wide setup, runs after initialDatabases
  # hbaConf = builtins.readFile ./pg_hba.conf;
  # initdbArgs = [ "--locale=C" "--encoding=UTF8" ];
  extensions = extensions: [ extensions.postgis extensions.timescaledb ];
  settings.shared_preload_libraries = "timescaledb";
};
```

Prefer `initialDatabases[].user` / `.pass` over hand-rolling `CREATE ROLE ... PASSWORD` in
`initialScript`: the module creates the role, sets the password, and assigns database ownership,
and asserts that `pass` is never set without `user`. Reserve `initialScript` for genuinely
server-wide setup.

`listen_addresses` is the switch between socket-only and TCP mode. Left at its default `""`,
postgres listens only on a unix socket in `$DEVENV_RUNTIME/postgres`, `PGHOST` points at that
directory, and **no `ports.main` is allocated** — referencing
`config.processes.postgres.ports.main.value` then fails evaluation with `attribute 'main'
missing`. Set `listen_addresses = "127.0.0.1"` whenever anything needs a TCP `DATABASE_URL`.
Either way the module exports `PGDATA`, `PGHOST`, and `PGPORT`.

## Redis

```nix
services.redis = {
  enable = true;
  port = 6379;                 # base port; 0 switches to unix socket only
  bind = "127.0.0.1";          # null means all interfaces
  extraConfig = "locale-collate C";
};
```

With `port = 0` no TCP port is allocated and the module exports `REDIS_UNIX_SOCKET`
(`$DEVENV_RUNTIME/redis.sock`) instead.

## MySQL / MariaDB

```nix
services.mysql = {
  enable = true;
  package = pkgs.mysql80;
  initialDatabases = [{ name = "myapp"; }];        # optional schema = ./schema.sql;
  ensureUsers = [{
    name = "myapp";
    password = "devpass";
    ensurePermissions = { "myapp.*" = "ALL PRIVILEGES"; };
  }];
  settings.mysqld.max_connections = 200;
};
```

## MongoDB

```nix
services.mongodb = {
  enable = true;
  additionalArgs = [ "--noauth" ];        # this is also the default
  # initDatabaseUsername / initDatabasePassword for an authenticated dev instance
  # replication.enable = true; replication.replSet = "rs0";
};
```

## Kafka

```nix
services.kafka = {
  enable = true;
  settings."broker.id" = 0;
  connect.enable = true;                 # Kafka Connect lives under services.kafka.connect
  connect.initialConnectors = [{ name = "sink"; config = { }; }];
};
```

There is no `services.kafka-connect.*` namespace — the kafka-connect module declares its
options under `services.kafka.connect.*`.

## MinIO (S3-compatible)

```nix
services.minio = {
  enable = true;
  buckets = [ "uploads" "assets" ];
  accessKey = "minioadmin";
  secretKey = "minioadmin";
  region = "us-east-1";
};
```

On current `devenv-nixpkgs/rolling` the `minio` derivation is marked insecure (upstream has
abandoned it). Either allow it explicitly in devenv.yaml or use Garage/RustFS instead:

```yaml
nixpkgs:
  permitted_insecure_packages:
    - "minio-2025-10-15T17-29-55Z"
```

## Garage / RustFS (S3-compatible alternatives)

```nix
services.garage = {
  enable = true;
  buckets = [ "uploads" ];
  region = "garage";
  replicationFactor = 1;
  ui.enable = true;
};

services.rustfs.enable = true;
```

## Vault

```nix
services.vault = {
  enable = true;
  address = "127.0.0.1:8200";   # default
  ui = true;                    # default
  # disableClustering / disableMlock both default to true
};
```

There is no `services.vault.devMode` option.

## Messaging, proxies, misc

```nix
services.nats = { enable = true; jetstream.enable = true; monitoring.enable = true; };
services.mosquitto = { enable = true; port = 1883; bind = "127.0.0.1"; };
services.rabbitmq = { enable = true; managementPlugin.enable = true; plugins = [ ]; };
services.nginx = { enable = true; httpConfig = "..."; };
services.caddy = { enable = true; virtualHosts."localhost".extraConfig = "respond \"ok\""; };
```

## All supported services

devenv 2.2.1 documents **42** services:

adminer, blackfire, caddy, cassandra, clickhouse, cockroachdb, couchdb, dynamodb-local,
elasticmq, elasticsearch, garage, httpbin, influxdb, kafka, keycloak, mailhog, mailpit,
meilisearch, memcached, minio, mongodb, mosquitto, mysql, nats, nginx,
nixseparatedebuginfod, opensearch, opentelemetry-collector, postgres, prometheus, rabbitmq,
redis, rustfs, sqld, tailscale, temporal, tideways, trafficserver, typesense, varnish, vault,
wiremock.

Kafka Connect ships as an extra module on top of kafka (`services.kafka.connect.*`) rather
than as a service of its own.

## How services define processes

Each service module declares a `processes.<service>` entry with port allocation and a
readiness probe, so services and your own processes share one dependency graph. Postgres, for
example, declares:

```nix
processes.postgres = {
  ports = lib.mkIf (cfg.listen_addresses != "") { main.allocate = cfg.port; };
  exec = "${startScript}/bin/start-postgres";
  ready = {
    exec = ''
      if [[ -f "$PGDATA/.devenv_initialized" ]]; then
        pg_isready -d template1 && psql -c "SELECT 1" template1 > /dev/null 2>&1
      else
        echo "Waiting for PostgreSQL initialization to complete..." 2>&1
        exit 1
      fi
    '';
    initial_delay = 2;      # seconds before the first probe
    probe_timeout = 4;      # seconds a single probe may take
    failure_threshold = 5;  # consecutive failures before the process is unhealthy
  };
};
```

Because the process is named after the service, your own processes and tasks depend on it by
that name:

```nix
processes.api.after = [ "devenv:processes:postgres" ];
tasks."db:migrate".after = [ "devenv:processes:postgres" ];
```

## Wiring service ports into your app

`ports.<port-name>.allocate` is a *base* port: devenv increments from it until it finds a free
one, so the running port can differ from the literal you wrote. Never hardcode 5432/6379/9000
in an env var — read the resolved value at evaluation time from
`config.processes.<service>.ports.<port-name>.value` and interpolate it:

```nix
{ pkgs, config, lib, ... }:

{
  services.postgres = {
    enable = true;
    listen_addresses = "127.0.0.1";        # required for a TCP port to exist
    initialDatabases = [{ name = "myapp"; user = "myapp"; pass = "devpass"; }];
  };
  services.redis.enable = true;
  services.minio.enable = true;

  env = {
    # dev-only credentials; anything real belongs in SecretSpec, not env
    DATABASE_URL = "postgresql://myapp:devpass@127.0.0.1:${toString config.processes.postgres.ports.main.value}/myapp";
    REDIS_URL = "redis://127.0.0.1:${toString config.processes.redis.ports.main.value}";
    CELERY_BROKER_URL = "redis://127.0.0.1:${toString config.processes.redis.ports.main.value}/0";
    S3_ENDPOINT = "http://127.0.0.1:${toString config.processes.minio.ports.api.value}";
  };
}
```

`config.processes.*` is available inside `env`, `scripts`, `processes.<name>.exec`, `ready`
probes, and `enterShell`, so the same expression works everywhere. Shelling out to
`devenv eval processes...` from `enterShell` is never necessary.

Port names are per module, not universal:

| Service | Port names | Notes |
| --- | --- | --- |
| postgres, mysql, redis, memcached, meilisearch, influxdb, typesense, wiremock, prometheus, adminer, varnish, httpbin, dynamodb-local, couchdb, sqld, mosquitto, vault, nixseparatedebuginfod | `main` | postgres needs `listen_addresses`; redis needs `port != 0` |
| minio, rustfs | `api`, `console` | |
| garage | `s3`, `admin`, `rpc` | |
| rabbitmq | `main`, `management`, `distribution`, `epmd` | |
| kafka | `main`, `controller` | Connect adds `main` on `processes.kafka-connect` |
| mailpit | `ui`, `smtp` | mailhog uses `api`, `smtp` |
| temporal | `main`, `ui` | |
| clickhouse | `main`, `http`, `keeper`, `raft` | |
| elasticsearch, opensearch | `http`, `transport` | |
| keycloak | `http`, `https`, `management` | |
| cockroachdb | `main`, `http` | |
| nats | `main`, `monitoring` | |
| blackfire | `main` | process is named `blackfire-agent` |

mongodb, nginx, caddy, elasticmq, opentelemetry-collector, tailscale, and tideways allocate no
named ports — configure them through their own address/port options. Several modules also
export conventional env vars you can use directly instead of rebuilding a URL: `PGHOST`/
`PGPORT`, `REDIS_UNIX_SOCKET`, `MINIO_PORT`/`MINIO_CONSOLE_PORT`/`MINIO_ROOT_USER`/
`MINIO_ROOT_PASSWORD`.

Set `strict_ports: true` in devenv.yaml when a fixed port is a hard requirement — devenv then
fails instead of silently allocating the next free one.

Options reference: https://devenv.sh/reference/options/
