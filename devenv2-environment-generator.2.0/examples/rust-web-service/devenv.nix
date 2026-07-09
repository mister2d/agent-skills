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
    initialDatabases = [{ name = "rustapp_dev"; }];
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
      restart = "on-failure";
      # Trigger cargo rebuild on source changes
      watch = [ "./src" "./migrations" "Cargo.toml" ];
    };
  };

  # ── Environment (non-secret) ───────────────────────────────────────────
  env = {
    RUST_LOG = "debug";
    RUST_BACKTRACE = "1";
  };

  # ── Git hooks ─────────────────────────────────────────────────────────
  git-hooks.hooks = {
    rustfmt.enable = true;
    clippy = {
      enable = true;
      settings.denyWarnings = true;
    };
  };

  enterShell = ''
    echo "Rust toolchain: $(rustc --version)"
    echo "Cargo: $(cargo --version)"
  '';
}
