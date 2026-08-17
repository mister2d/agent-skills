{ pkgs, config, ... }:

{
  # ── Language toolchain ─────────────────────────────────────────────────
  languages.rust = {
    enable = true;
    channel = "stable";
    components = [ "rustfmt" "clippy" "rust-analyzer" ];
    lsp.enable = true;
  };

  # ── Build dependencies ─────────────────────────────────────────────────
  packages = with pkgs; [
    pkg-config
    openssl.dev
    postgresql_16   # libpq for sqlx
    curl
  ];

  # ── Backing services ───────────────────────────────────────────────────
  services.postgres = {
    enable = true;
    package = pkgs.postgresql_16;
    # `user`/`pass` create and own the database; `pass` requires `user`.
    initialDatabases = [{
      name = "rustapp_dev";
      user = "rustapp";
      pass = "devpass";
    }];
    # "" (the default) means unix socket only and no allocated TCP port.
    # Set it so processes.postgres.ports.main exists for the DSN below.
    listen_addresses = "127.0.0.1";
  };

  # ── Application processes ───────────────────────────────────────────────
  processes = {
    migrate = {
      exec = "sqlx migrate run";
      after = [ "devenv:processes:postgres" ];
    };

    api = {
      exec = "cargo run --release";
      ports.http.allocate = 3000;
      after = [
        "devenv:processes:postgres"
        "devenv:processes:migrate@completed"
      ];
      ready.http.get = {
        port = config.processes.api.ports.http.value;
        path = "/health";
      };
      restart.on = "on_failure";
      watch.paths = [ ./src ./migrations ];
      watch.extensions = [ "rs" "toml" ];
    };
  };

  # ── Environment (non-secret) ───────────────────────────────────────────
  env = {
    RUST_LOG = "debug";
    RUST_BACKTRACE = "1";
    # sqlx (CLI and macros) reads DATABASE_URL. Built from the allocated
    # postgres port and the role declared above — no port literal.
    DATABASE_URL = "postgresql://rustapp:devpass@127.0.0.1:${toString config.processes.postgres.ports.main.value}/rustapp_dev";
  };

  # ── Git hooks ─────────────────────────────────────────────────────────
  # Requires the git-hooks input in devenv.yaml.
  git-hooks.hooks = {
    rustfmt.enable = true;
    clippy = {
      enable = true;
      settings.allFeatures = true;
    };
  };

  enterShell = ''
    echo "Rust toolchain: $(rustc --version)"
    echo "Cargo: $(cargo --version)"
    echo "  devenv up -d → background process manager; devenv up attaches to it"
  '';
}
