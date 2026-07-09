{ pkgs, config, ... }:

{
  # ── Language toolchain ─────────────────────────────────────────────────
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    corepack.enable = true;   # pnpm / yarn via corepack
  };
  languages.typescript = {
    enable = true;
    lsp.enable = true;        # tsserver
  };

  # ── CLI tools ──────────────────────────────────────────────────────────
  packages = with pkgs; [
    redis           # redis-cli
    curl
  ];

  # ── Backing services ───────────────────────────────────────────────────
  services.redis = {
    enable = true;
    port = 6379;
  };

  # ── Application processes ───────────────────────────────────────────────
  processes = {
    # Next.js / Vite / CRA dev server
    frontend = {
      exec = "pnpm dev --port ${toString config.processes.frontend.ports.http.value}";
      ports.http.allocate = 3000;
      ready.http.get = {
        port = config.processes.frontend.ports.http.value;
        path = "/";
      };
      watch = [ "./src" "./public" "next.config.js" ];
    };

    # Express / Fastify API
    api = {
      exec = "node dist/server.js";
      ports.http.allocate = 4000;
      after = [ "devenv:processes:redis" ];
      ready.http.get = {
        port = config.processes.api.ports.http.value;
        path = "/api/health";
      };
      restart = "on-failure";
    };
  };

  # ── Environment (non-secret) ───────────────────────────────────────────
  env = {
    NODE_ENV = "development";
    REDIS_URL = "redis://127.0.0.1:6379";
  };

  # ── Git hooks ─────────────────────────────────────────────────────────
  git-hooks.hooks = {
    eslint.enable = true;
    prettier = {
      enable = true;
      settings.write = true;
    };
  };

  enterShell = ''
    echo "Node.js: $(node --version) | pnpm: $(pnpm --version)"
  '';
}
