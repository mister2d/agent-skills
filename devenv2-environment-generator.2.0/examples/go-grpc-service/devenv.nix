{ pkgs, config, ... }:

{
  # ── Language toolchain ─────────────────────────────────────────────────
  languages.go = {
    enable = true;
    package = pkgs.go_1_22;
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
    initialDatabases = [{ name = "goapp"; }];
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
      # gRPC health check via exec probe
      ready.exec = "grpcurl -plaintext localhost:${toString config.processes.grpc.ports.grpc.value} grpc.health.v1.Health/Check";
      restart = "on-failure";
      watch = [ "./cmd" "./internal" "go.mod" ];
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
  };

  git-hooks.hooks = {
    gofmt.enable = true;
    govet.enable = true;
  };

  enterShell = ''
    echo "Go: $(go version)"
    echo "protoc: $(protoc --version)"
  '';
}
