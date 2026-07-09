# Service Configuration Reference

## PostgreSQL

```nix
services.postgres = {
  enable = true;
  package = pkgs.postgresql_16;
  initialDatabases = [{ name = "myapp"; }];
  initialScript = ''
    CREATE ROLE myapp WITH LOGIN PASSWORD 'devpassword';
    GRANT ALL ON DATABASE myapp TO myapp;
  '';
  listen_addresses = "127.0.0.1";
};
```

## Redis

```nix
services.redis = {
  enable = true;
  port = 6379;
};
```

## MySQL / MariaDB

```nix
services.mysql = {
  enable = true;
  package = pkgs.mysql80;
  initialDatabases = [{ name = "myapp"; }];
  ensureUsers = [{
    name = "myapp";
    ensurePermissions = { "myapp.*" = "ALL PRIVILEGES"; };
  }];
};
```

## Kafka

```nix
services.kafka.enable = true;
services.zookeeper.enable = true;   # Kafka requires ZooKeeper
```

## MinIO (S3-compatible)

```nix
services.minio = {
  enable = true;
  buckets = [ "uploads" "assets" ];
};
```

## Vault

```nix
services.vault = {
  enable = true;
  devMode = true;
};
```

## Other supported services

adminer, blackfire, caddy, cassandra, clickhouse, cockroachdb, couchdb,
dynamodb-local, elasticmq, elasticsearch, httpbin, influxdb, kafka, keycloak,
mailhog, mailpit, meilisearch, memcached, minio, mongodb, mysql, nats, nginx,
opensearch, opentelemetry-collector, postgres, prometheus, rabbitmq, redis,
sqld, tailscale, temporal, tideways, trafficserver, typesense, varnish, vault,
wiremock.

Options reference: https://devenv.sh/reference/options/
