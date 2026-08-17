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
  # services.redis.port only sets the *requested* port (default 6379); the
  # port actually bound is processes.redis.ports.main.value, which shifts
  # when 6379 is taken. Leave it at the default and read the allocation.
  # (services.redis.port = 0 would switch redis to a unix socket instead.)
  services.redis.enable = true;

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
      watch.paths = [ ./src ./public ];
      watch.extensions = [ "tsx" "ts" "jsx" "js" "css" ];
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
      restart.on = "on_failure";
    };
  };

  # ── Environment (non-secret) ───────────────────────────────────────────
  env = {
    NODE_ENV = "development";
    # Follows the allocated redis port instead of pinning 6379.
    REDIS_URL = "redis://127.0.0.1:${toString config.processes.redis.ports.main.value}";
  };

  # ── Git hooks ─────────────────────────────────────────────────────────
  # Requires the git-hooks input in devenv.yaml.
  git-hooks.hooks = {
    eslint.enable = true;
    prettier = {
      enable = true;
      settings.write = true;
    };
  };

  enterShell = ''
    echo "Node.js: $(node --version) | pnpm: $(pnpm --version)"
    echo "Redis:   $REDIS_URL"
    echo "  devenv up -d → background; devenv up → attach; devenv down → stop"
  '';
}
