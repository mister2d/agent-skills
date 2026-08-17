{ pkgs, config, ... }:

{
  # ── Language toolchain ─────────────────────────────────────────────────
  languages.go = {
    enable = true;
    # Left at the default (pkgs.go) so the example does not break when the
    # rolling nixpkgs drops an old versioned attribute. Pin with
    # `package = pkgs.go_1_26;` for a nixpkgs-provided version, or
    # `version = "1.26.0";` which resolves through the go-overlay input.
    lsp.enable = true;     # gopls
  };

  packages = with pkgs; [
    protobuf
    protoc-gen-go
    protoc-gen-go-grpc
    grpcurl
    postgresql_16
  ];

  # ── Backing services ───────────────────────────────────────────────────
  services.postgres = {
    enable = true;
    package = pkgs.postgresql_16;
    initialDatabases = [{
      name = "goapp";
      user = "goapp";
      pass = "devpass";
    }];
    # Required for a TCP DSN: with the default "" postgres listens on the
    # unix socket only and processes.postgres.ports.main is not allocated.
    listen_addresses = "127.0.0.1";
  };

  # ── Application processes ───────────────────────────────────────────────
  processes = {
    migrate = {
      exec = "goose -dir ./migrations postgres \"$DATABASE_URL\" up";
      after = [ "devenv:processes:postgres" ];
    };

    grpc = {
      exec = "go run ./cmd/server --grpc-port ${toString config.processes.grpc.ports.grpc.value}";
      ports.grpc.allocate = 50051;
      after = [
        "devenv:processes:postgres"
        "devenv:processes:migrate@completed"
      ];
      ready.exec = "grpcurl -plaintext localhost:${toString config.processes.grpc.ports.grpc.value} grpc.health.v1.Health/Check";
      restart.on = "on_failure";
      watch.paths = [ ./cmd ./internal ];
      watch.extensions = [ "go" ];
    };

    # REST gateway (grpc-gateway)
    gateway = {
      exec = "go run ./cmd/gateway --port ${toString config.processes.gateway.ports.http.value} --grpc-addr localhost:${toString config.processes.grpc.ports.grpc.value}";
      ports.http.allocate = 8080;
      after = [ "devenv:processes:grpc" ];
      ready.http.get = {
        port = config.processes.gateway.ports.http.value;
        path = "/healthz";
      };
    };
  };

  env = {
    GOFLAGS = "-mod=vendor";
    LOG_FORMAT = "json";
    LOG_LEVEL = "debug";

    # $DATABASE_URL is consumed by the migrate process above, so it has to be
    # declared. SecretSpec supplies it when the provider has a value (staging,
    # shared databases); otherwise fall back to the local dev DSN built from
    # the allocated postgres port.
    DATABASE_URL = config.secretspec.secrets.DATABASE_URL or
      "postgresql://goapp:devpass@127.0.0.1:${toString config.processes.postgres.ports.main.value}/goapp";
  };

  # Requires the git-hooks input in devenv.yaml.
  git-hooks.hooks = {
    gofmt.enable = true;
    govet.enable = true;
  };

  enterShell = ''
    echo "Go: $(go version)"
    echo "protoc: $(protoc --version)"
    echo "gRPC on :${toString config.processes.grpc.ports.grpc.value}, gateway on :${toString config.processes.gateway.ports.http.value}"
    echo "  devenv up -d → background; devenv up → attach; devenv down → stop"
  '';
}
