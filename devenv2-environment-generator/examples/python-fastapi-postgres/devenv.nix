{ pkgs, config, ... }:

{
  # ── Language toolchain ─────────────────────────────────────────────────
  languages.python = {
    enable = true;
    version = "3.12";
    uv.enable = true;        # Fast resolver/installer
    venv.enable = true;
    lsp.enable = true;       # pyright
  };

  # ── CLI tools ──────────────────────────────────────────────────────────
  packages = with pkgs; [
    postgresql_16   # psql client
    curl
    jq
  ];

  # ── Backing services ───────────────────────────────────────────────────
  services.postgres = {
    enable = true;
    package = pkgs.postgresql_16;
    # `user` creates the owning role and `pass` sets its password, so no
    # hand-rolled CREATE ROLE in initialScript. `pass` requires `user`.
    initialDatabases = [{
      name = "myapp_dev";
      user = "myapp";
      pass = "devpass";
    }];
    # Default is "" — unix socket only. A non-empty value is what makes
    # devenv allocate processes.postgres.ports.main, so any config that
    # reads that port must set this.
    listen_addresses = "127.0.0.1";
  };

  # ── Application processes ───────────────────────────────────────────────
  processes = {
    # One-shot: run migrations before starting api
    migrate = {
      exec = "alembic upgrade head";
      after = [ "devenv:processes:postgres" ];
    };

    api = {
      exec = "uvicorn app.main:app --host 0.0.0.0 --port ${toString config.processes.api.ports.http.value} --reload";
      ports.http.allocate = 8000;
      after = [
        "devenv:processes:postgres"
        "devenv:processes:migrate@completed"
      ];
      ready.http.get = {
        port = config.processes.api.ports.http.value;
        path = "/healthz";
      };
      restart.on = "on_failure";
    };
  };

  # ── Environment variables ──────────────────────────────────────────────
  env = {
    APP_ENV = "development";
    LOG_LEVEL = "debug";

    # SecretSpec value when the provider has one, otherwise a local dev DSN
    # built from the allocated postgres port — never a literal 5432.
    DATABASE_URL = config.secretspec.secrets.DATABASE_URL or
      "postgresql://myapp:devpass@127.0.0.1:${toString config.processes.postgres.ports.main.value}/myapp_dev";
  };

  # ── Git hooks ──────────────────────────────────────────────────────────
  # Requires the git-hooks input in devenv.yaml; the runner is prek.
  git-hooks.hooks = {
    ruff.enable = true;         # lint
    ruff-format.enable = true;  # format
    mypy.enable = true;         # type-check
  };

  # ── Shell entry message ─────────────────────────────────────────────────
  enterShell = ''
    echo "devenv ready — Python $(python --version)"
    echo "  devenv up -d → start postgres + api in the background"
    echo "  devenv up    → attach to the running manager (2.2+)"
    echo "  devenv down  → stop everything"
  '';
}
