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
    initialDatabases = [{ name = "myapp_dev"; }];
    initialScript = ''
      CREATE ROLE myapp WITH LOGIN PASSWORD 'devpass';
      GRANT ALL ON DATABASE myapp_dev TO myapp;
    '';
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
      # Dynamic port allocation — safe for parallel agent runs
      ports.http.allocate = 8000;
      after = [
        "devenv:processes:postgres"
        "devenv:processes:migrate@completed"
      ];
      ready.http.get = {
        port = config.processes.api.ports.http.value;
        path = "/healthz";
      };
      restart = "on-failure";
    };
  };

  # ── Environment variables (non-secret) ─────────────────────────────────
  env = {
    APP_ENV = "development";
    LOG_LEVEL = "debug";
    # DATABASE_URL declared in secretspec.toml
  };

  # ── Shell entry message ─────────────────────────────────────────────────
  enterShell = ''
    echo "devenv ready — Python $(python --version)"
    echo "  devenv up    → start postgres + api"
    echo "  devenv test  → run test suite"
  '';
}
