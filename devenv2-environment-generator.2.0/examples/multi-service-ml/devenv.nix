{ pkgs, config, ... }:

#
# Multi-service ML training + serving environment.
# Services: Postgres (metadata), MinIO (artifacts), Redis (task queue).
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
    awscli2       # MinIO compatible via S3 endpoint
    postgresql_16
    redis
    curl
    jq
  ];

  # ── Services ──────────────────────────────────────────────────────────
  services.postgres = {
    enable = true;
    package = pkgs.postgresql_16;
    initialDatabases = [{ name = "mlops"; }];
    initialScript = ''
      CREATE ROLE mlops WITH LOGIN PASSWORD 'devpass';
      GRANT ALL ON DATABASE mlops TO mlops;
    '';
    listen_addresses = "127.0.0.1";
  };

  services.redis.enable = true;

  services.minio = {
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
      restart = "on-failure";
    };

    # Celery worker for async training jobs
    worker = {
      exec = "celery -A app.worker worker --loglevel=info --concurrency=2";
      after = [
        "devenv:processes:redis"
        "devenv:processes:postgres"
        "devenv:processes:migrate@completed"
      ];
      restart = "on-failure";
    };

    # Celery Flower — task queue monitoring UI
    flower = {
      exec = "celery -A app.worker flower --port=${toString config.processes.flower.ports.http.value}";
      ports.http.allocate = 5555;
      after = [ "devenv:processes:worker" ];
      ready.http.get = {
        port = config.processes.flower.ports.http.value;
        path = "/";
      };
    };
  };

  env = {
    APP_ENV = "development";
    CELERY_BROKER_URL = "redis://127.0.0.1:6379/0";
    CELERY_RESULT_BACKEND = "redis://127.0.0.1:6379/1";
    # S3-compatible endpoint for MinIO
    AWS_ENDPOINT_URL = "http://127.0.0.1:9000";
    AWS_DEFAULT_REGION = "us-east-1";
    # DATABASE_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY → secretspec.toml
  };

  enterShell = ''
    echo "ML environment ready"
    echo "  API:    http://localhost:$(devenv eval processes.api.ports.http.value 2>/dev/null || echo 8000)"
    echo "  Flower: http://localhost:$(devenv eval processes.flower.ports.http.value 2>/dev/null || echo 5555)"
    echo "  MinIO:  http://localhost:9000"
  '';
}
