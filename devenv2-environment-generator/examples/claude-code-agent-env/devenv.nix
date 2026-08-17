{ pkgs, config, ... }:

#
# Python + Postgres service that is meant to be driven by Claude Code.
# Shows the claude.code integration (one hook, one MCP server), profiles for
# dev vs CI, and the devenv 2.2 attach workflow.
#

{
  name = "claude-code-agent-env";

  # ── Language toolchain ─────────────────────────────────────────────────
  languages.python = {
    enable = true;
    version = "3.12";
    uv.enable = true;
    venv.enable = true;
    lsp.enable = true;       # pyright; switched off in the ci profile
  };

  packages = with pkgs; [
    postgresql_16   # psql client
    jq              # hooks receive their tool payload as JSON on stdin
  ];

  # ── Git hooks ──────────────────────────────────────────────────────────
  # Requires the git-hooks input in devenv.yaml. The runner is prek.
  git-hooks.hooks = {
    ruff.enable = true;
    ruff-format.enable = true;
  };

  # ── Claude Code integration ────────────────────────────────────────────
  claude.code.enable = true;

  # Exactly one hook: re-run the project's git-hooks after Claude edits a
  # file. `git-hooks-run` is devenv's built-in hook name. Give every field
  # together — defining any attribute replaces the submodule default as a
  # whole, and a missing `command` then fails evaluation.
  claude.code.hooks.git-hooks-run = {
    enable = true;
    name = "Run git-hooks after edits";
    hookType = "PostToolUse";               # PreToolUse | PostToolUse | Stop | …
    matcher = "^(Edit|MultiEdit|Write)$";   # regex over tool names
    command = ''cd "$DEVENV_ROOT" && ${config.git-hooks.package.meta.mainProgram} run'';
  };

  # Exactly one MCP server, stdio flavour: devenv's own server, which gives
  # the agent search_packages / search_options. Entering the shell writes
  # .mcp.json (and .claude/settings.json for the hook) as store symlinks.
  # Defining any server replaces the whole default attrset, so the built-in
  # remote entry ("mcp.devenv.sh", type http) is dropped — re-declare it here
  # if you want both.
  claude.code.mcpServers.devenv = {
    type = "stdio";                 # "stdio" (command/args/env) or "http" (url/headers)
    command = "devenv";
    args = [ "mcp" ];
    env.DEVENV_ROOT = config.devenv.root;
  };

  # ── Profiles ───────────────────────────────────────────────────────────
  # devenv.yaml pins `profile: default`, so this one is active unless you
  # pass --profile ci. The function form ({ config, ... }: { … }) is required
  # because the module reads values it sets itself (the postgres port).
  profiles.default.module = { config, ... }: {
    services.postgres = {
      enable = true;
      package = pkgs.postgresql_16;
      initialDatabases = [{
        name = "agentdb";
        user = "agent";
        pass = "devpass";
      }];
      # Non-empty listen_addresses is what allocates
      # processes.postgres.ports.main; the default "" is socket-only.
      listen_addresses = "127.0.0.1";
    };

    processes.api = {
      exec = "uvicorn app.main:app --port ${toString config.processes.api.ports.http.value}";
      ports.http.allocate = 8000;
      after = [ "devenv:processes:postgres" ];
      ready.http.get = {
        port = config.processes.api.ports.http.value;
        path = "/healthz";
      };
      restart.on = "on_failure";
    };

    env.DATABASE_URL = config.secretspec.secrets.DATABASE_URL or
      "postgresql://agent:devpass@127.0.0.1:${toString config.processes.postgres.ports.main.value}/agentdb";
  };

  # Leaner CI profile: no agent tooling, no language server, no services —
  # only the toolchain and the hooks a pipeline needs. Since 2.2.1 a profile
  # outranks the base configuration without lib.mkForce, including for
  # package-valued options.
  profiles.ci.module = {
    claude.code.enable = false;
    languages.python.lsp.enable = false;
    env.CI = "true";
  };

  enterShell = ''
    echo "Claude Code agent environment — .mcp.json and .claude/settings.json"
    echo "are generated from devenv.nix; do not edit them by hand."
    echo ""
    echo "Process workflow (devenv 2.2):"
    echo "  devenv up -d              start the process manager in the background"
    echo "  devenv up                 attach to it — status, ports, logs;"
    echo "                            Ctrl-C asks whether to detach or stop"
    echo "  devenv up api             start one process via the same"
    echo "                            dependency-aware launch path"
    echo "  devenv processes attach   re-attach without restarting anything"
    echo "  devenv down               stop the background manager"
    echo ""
    echo "  devenv --profile ci shell   CI variant: no agent tooling, no services"
  '';
}
