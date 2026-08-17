# AI Integration

devenv declares AI coding-agent configuration as part of the environment: the `claude.code.*`
namespace generates Claude Code's project files, `opencode.*` does the same for OpenCode, and
`devenv mcp` exposes package and option search over the Model Context Protocol. devenv also detects
when it is running under a coding agent and drops the TUI so progress output does not burn tokens.

## claude.code

```nix
{
  claude.code.enable = true;
}
```

With `enable = true`, devenv writes these files through the `files` mechanism:

| Generated file | Source |
| --- | --- |
| `.claude/settings.json` | hooks, permissions, `model`, `env`, `apiKeyHelper`, `forceLoginMethod`, `cleanupPeriodDays` |
| `.mcp.json` | `claude.code.mcpServers` (written whenever the set is non-empty) |
| `.claude/commands/<name>.md` | `claude.code.commands.<name>` |
| `.claude/agents/<name>.md` | `claude.code.agents.<name>` |

### Top-level options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `claude.code.enable` | bool | `false` | Turn the integration on |
| `claude.code.model` | null or string | `null` | Override the default model |
| `claude.code.env` | attrs of string | `{}` | Environment variables for Claude Code sessions |
| `claude.code.apiKeyHelper` | null or string | `null` | Script that prints an API key on stdout |
| `claude.code.forceLoginMethod` | null, `"browser"`, `"api-key"` | `null` | Restrict the login method |
| `claude.code.cleanupPeriodDays` | null or int | `null` | Chat transcript retention in days |

### Hooks

Each entry of `claude.code.hooks.<name>` is a submodule:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enable` | bool | `true` | Whether this hook is emitted |
| `name` | string | `""` | Label shown in logs |
| `hookType` | enum | `"PostToolUse"` | Lifecycle point (see below) |
| `matcher` | string | `""` | Regex matched against tool names, for `PreToolUse` / `PostToolUse` |
| `command` | string | required | Shell command; receives a JSON object on stdin |

`hookType` accepts `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`,
`UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStart`, `SubagentStop`,
`PreCompact`, `PermissionRequest`, `WorktreeCreate`, `WorktreeRemove`, `TeammateIdle`,
`TaskCompleted`, `ConfigChange`.

```nix
{
  claude.code.hooks = {
    protect-secrets = {
      enable = true;
      name = "Protect sensitive files";
      hookType = "PreToolUse";              # non-zero exit blocks the tool call
      matcher = "^(Edit|MultiEdit|Write)$";
      command = ''
        json=$(cat)                          # hook input arrives as JSON on stdin
        file_path=$(echo "$json" | jq -r '.file_path // empty')
        if [[ "$file_path" =~ \.(env|secret)$ ]]; then
          echo "Error: cannot edit sensitive files"
          exit 1
        fi
      '';
    };

    track-completion = {
      hookType = "Stop";
      command = ''echo "finished at $(date)" >> claude-sessions.log'';
    };
  };
}
```

For file tools the stdin JSON carries at least `tool` and `file_path`.

#### Built-in `git-hooks-run`

`claude.code.hooks.git-hooks-run` is predefined: it is enabled whenever `git-hooks.enable` is true,
runs as `PostToolUse` with matcher `^(Edit|MultiEdit|Write)$`, and executes
`cd "$DEVENV_ROOT" && <git-hooks runner> run` — the runner being `git-hooks.package`, `prek` by
default. Set `claude.code.hooks.git-hooks-run.enable = false;` to suppress it.

### Agents

```nix
{
  claude.code.agents.code-reviewer = {
    description = "Reviews changes for correctness and security";
    proactive = true;                     # let Claude invoke it automatically
    tools = [ "Read" "Grep" "TodoWrite" ];
    model = "opus";                       # null | "opus" | "sonnet" | "haiku"
    permissionMode = "plan";              # null | "default" | "acceptEdits" | "plan" | "bypassPermissions"
    prompt = ''
      You are an expert code reviewer. Check readability, error handling,
      security, and adherence to project conventions.
    '';
  };
}
```

| Option | Type | Default |
| --- | --- | --- |
| `claude.code.agents.<name>.description` | string | required |
| `claude.code.agents.<name>.prompt` | lines | required |
| `claude.code.agents.<name>.proactive` | bool | `false` |
| `claude.code.agents.<name>.tools` | list of string | `[ ]` (no restriction emitted) |
| `claude.code.agents.<name>.model` | null or `opus`/`sonnet`/`haiku` | `null` |
| `claude.code.agents.<name>.permissionMode` | null or `default`/`acceptEdits`/`plan`/`bypassPermissions` | `null` |

Tool names commonly granted: `Read`, `Write`, `Edit`, `MultiEdit`, `Grep`, `Glob`, `Bash`,
`TodoWrite`, `WebFetch`, `WebSearch`.

### Commands

`claude.code.commands` is an attrset of name to markdown body; each becomes the slash command
`/<name>`.

```nix
{
  claude.code.commands.test = ''
    Run the test suite

    ```bash
    devenv test
    ```
  '';
}
```

### MCP servers

```nix
{
  claude.code.mcpServers = {
    devenv = {
      type = "stdio";
      command = "devenv";
      args = [ "mcp" ];
      env = { DEVENV_ROOT = config.devenv.root; };
    };

    linear = {
      type = "http";
      url = "https://mcp.linear.app/mcp";
      headers = { Authorization = "Bearer TOKEN"; };
    };
  };
}
```

`type` is `"stdio"` or `"http"`. A `stdio` server requires `command` (`args` and `env` optional); an
`http` server requires `url` (`headers` optional) — evaluation fails otherwise. The default value of
`claude.code.mcpServers` is not empty: it contains `"mcp.devenv.sh"` as an `http` server pointing at
`https://mcp.devenv.sh`, so enabling the integration already produces a `.mcp.json`. Assign the whole
attrset to replace that default.

### Permissions

```nix
{
  claude.code.permissions = {
    defaultMode = "acceptEdits";          # default | acceptEdits | plan | bypassPermissions
    disableBypassPermissionsMode = true;
    additionalDirectories = [ "/shared/libs" ];
    rules = {
      Edit.deny = [ "*.secret" "*.env" ];
      Bash = {
        allow = [ "ls:*" "cat:*" ];
        ask = [ "git:*" ];
        deny = [ "rm -rf:*" "sudo:*" ];
      };
      WebSearch.allow = [ "" ];           # empty string emits a bare tool entry
    };
  };
}
```

Rules belong under `rules`; tool names written directly under `permissions` still work for backward
compatibility, and `rules` wins on conflict.

https://devenv.sh/integrations/claude-code/

## opencode

`opencode.enable` turns on the OpenCode integration. Its configuration surface is
`opencode.settings`, `opencode.mcp`, `opencode.rules`, `opencode.commands`, `opencode.agents`,
`opencode.skills`, `opencode.themes`, `opencode.tools`, plus `opencode.web.enable` and
`opencode.web.extraArgs` for the bundled web service (which registers a process when enabled). It has
no dedicated documentation page; check `/reference/options/` for the current shapes before using it.

## Coding-agent detection

devenv detects coding agents and switches to quiet mode, suppressing the TUI so progress rendering
does not consume tokens. In 2.1 detection was limited to a few environment variables; 2.2 moved it to
the `detect-coding-agent` crate, which recognises Claude Code, Aider, and autonomous/cloud agents.

- Force normal output back on: `--verbose`, or `--tui true`.
- Disable detection entirely: `DEVENV_NO_AI_AGENT=1`.
- `CI` independently disables the TUI by default.

## devenv mcp

```bash
devenv mcp              # stdio transport, for tools that spawn devenv as a subprocess
devenv mcp --http       # HTTP transport on port 8080
devenv mcp --http 9090
```

Tools exposed: `search_packages` (packages in the nixpkgs input) and `search_options` (devenv
configuration options). A hosted instance is available at `https://mcp.devenv.sh`, which is what the
default `claude.code.mcpServers` entry points at.

https://devenv.sh/mcp/

## Generating configuration with AI

```bash
devenv generate
```

`devenv generate` writes a `devenv.yaml` and `devenv.nix` using AI, seeded from the repository it is
run in. The hosted equivalent is [devenv.new](https://devenv.new), a coding agent backed by the same
package and option search that powers `devenv mcp`. Treat generated output as a draft: verify option
paths against `/reference/options/` before committing it.
