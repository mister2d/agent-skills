{ pkgs, config, ... }:

#
# Multi-service ML training + serving environment.
# Services: Postgres (metadata), Garage (S3-compatible artifacts), Redis (task queue).
# Processes: api, celery worker, flower (monitor).
#

{
  languages.python = {
    enable = true;
    version = "3.11";
    uv.enable = true;
    venv.enable = true;
    lsp.enable = true;
  };

  packages = with pkgs; [
    awscli2       # Garage speaks the S3 API, so the AWS CLI works against it
    postgresql_16
    redis
    curl
    jq
  ];

  # ── Services ──────────────────────────────────────────────────────────
  services.postgres = {
    enable = true;
    package = pkgs.postgresql_16;
    # Owning role comes from initialDatabases, not a hand-written CREATE ROLE.
    initialDatabases = [{
      name = "mlops";
      user = "mlops";
      pass = "devpass";
    }];
    # Non-empty listen_addresses is what allocates
    # processes.postgres.ports.main, which the DSN below reads.
    listen_addresses = "127.0.0.1";
  };

  services.redis.enable = true;

  # S3-compatible object storage for models/datasets/artifacts.
  services.garage = {
    enable = true;
    buckets = [ "models" "datasets" "artifacts" ];
  };

  # ── Processes ─────────────────────────────────────────────────────────
  processes = {
    migrate = {
      exec = "alembic upgrade head";
      after = [ "devenv:processes:postgres" ];
    };

    api = {
      exec = "uvicorn app.main:app --port ${toString config.processes.api.ports.http.value}";
      ports.http.allocate = 8000;
      after = [
        "devenv:processes:postgres"
        "devenv:processes:migrate@completed"
        "devenv:processes:redis"
      ];
      ready.http.get = {
        port = config.processes.api.ports.http.value;
        path = "/healthz";
      };
      restart.on = "on_failure";
    };

    # Celery worker for async training jobs
    worker = {
      exec = "celery -A app.worker worker --loglevel=info --concurrency=2";
      after = [
        "devenv:processes:redis"
        "devenv:processes:postgres"
        "devenv:processes:migrate@completed"
      ];
      restart.on = "on_failure";
    };

    # Celery Flower — task queue monitoring UI
    flower = {
      exec = "celery -A app.worker flower --port=${toString config.processes.flower.ports.http.value}";
      ports.http.allocate = 5555;
      # A bare dependency means @ready, which devenv rejects for a process
      # with no ready probe and no allocated ports — the worker has neither,
      # so wait for @started instead.
      after = [ "devenv:processes:worker@started" ];
      ready.http.get = {
        port = config.processes.flower.ports.http.value;
        path = "/";
      };
    };
  };

  env = {
    APP_ENV = "development";

    # Every URL below tracks an allocated port, so a busy 6379/3900 shifts
    # the whole environment consistently instead of silently mismatching.
    CELERY_BROKER_URL = "redis://127.0.0.1:${toString config.processes.redis.ports.main.value}/0";
    CELERY_RESULT_BACKEND = "redis://127.0.0.1:${toString config.processes.redis.ports.main.value}/1";

    AWS_ENDPOINT_URL = "http://127.0.0.1:${toString config.processes.garage.ports.s3.value}";
    AWS_DEFAULT_REGION = config.services.garage.region;

    DATABASE_URL = config.secretspec.secrets.DATABASE_URL or
      "postgresql://mlops:devpass@127.0.0.1:${toString config.processes.postgres.ports.main.value}/mlops";
  };

  enterShell = ''
    echo "ML environment ready"
    echo "  API:    http://localhost:${toString config.processes.api.ports.http.value}"
    echo "  Flower: http://localhost:${toString config.processes.flower.ports.http.value}"
    echo "  S3:     $AWS_ENDPOINT_URL"
    echo "  devenv up -d → background; devenv up → attach; devenv down → stop"
  '';
}
