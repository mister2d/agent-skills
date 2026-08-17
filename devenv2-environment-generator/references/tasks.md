# Tasks Reference

Tasks are units of work wired into a dependency graph (a DAG) and executed in parallel where
possible. They are the right tool for shell setup, migrations, code generation and any step
that must run before something else. Processes are tasks too, so the two share one graph —
see `processes.md`.

## Naming

Task keys are strings of the form `"<namespace>:<name>"`:

```nix
tasks."myapp:hello".exec = ''echo "Hello, world!"'';
```

Reserve one namespace per concern (`myapp:`, `db:`, `frontend:`). The namespace is
addressable on its own: `devenv tasks run myapp` runs every task in the `myapp` namespace.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `exec` | null or string | `null` | Command to execute |
| `before` | list of string | `[ ]` | Tasks that depend on this one completing first |
| `after` | list of string | `[ ]` | Tasks that must complete before this one runs |
| `status` | null or string | `null` | Probe command; exit 0 skips `exec` |
| `execIfModified` | list of string | `[ ]` | Glob paths; run only when they changed |
| `package` | package | `pkgs.bash` | Interpreter used to run `exec` |
| `binary` | null or string | `null` | Override `package.meta.mainProgram` |
| `cwd` | null or string | `null` | Working directory |
| `env` | attrset of string | `{ }` | Environment variables for this task |
| `input` | attrset of anything | `{ }` | JSON input exposed as `$DEVENV_TASK_INPUT` |
| `exports` | list of string | `[ ]` | Env var names this task exports to dependents |
| `description` | string | `""` | Shown by `devenv tasks list` |
| `showOutput` | boolean | `false` | Always print stdout/stderr, not just on failure |
| `type` | `"oneshot"` \| `"process"` | `"oneshot"` | Run once, or supervise as a long-running process |
| `process` | submodule | `{ }` | Process settings; only used when `type = "process"` |

```nix
tasks."<namespace>:<name>" = {
  exec = "...";
  before = [ "devenv:enterShell" ];
  after = [ "devenv:processes:<name>" ];
  status = "check-if-needed";       # exit 0 = skip
  execIfModified = [ "src/**" ];
};
```

## Dependencies and suffixes

`before` and `after` describe the same edge from opposite ends — declare it from whichever
side is convenient.

```nix
# equivalent
tasks."myapp:build".after   = [ "myapp:generate" ];
tasks."myapp:generate".before = [ "myapp:build" ];
```

| Suffix | Satisfied when | Failure propagates |
| --- | --- | --- |
| `@started` | the target has begun executing | yes |
| `@ready` | a process passes its readiness probe (processes) | yes |
| `@succeeded` | the target exits 0, or is skipped (tasks) | yes |
| `@completed` | the target finishes, whatever the exit code | no (soft dependency) |

With no suffix the default is `@ready` for processes and `@succeeded` for oneshot tasks.
Tasks and processes mix freely in the same chain.

```nix
tasks."myapp:configure" = {
  exec = "create-buckets";
  after = [ "devenv:processes:garage@ready" ];
};
```

## Built-in namespaces

- `devenv:enterShell` — runs before the shell is entered and before processes start.
- `devenv:enterTest` — runs before `devenv test`; depends on `devenv:enterShell`.
- `devenv:processes:<name>` — every entry in `processes.*` is exposed as a task.

Hook into a lifecycle event with `before`:

```nix
tasks = {
  "myapp:setup" = {
    exec = "echo 'Preparing…'";
    before = [ "devenv:enterShell" ];
  };
  "myapp:fixtures" = {
    exec = "seed-fixtures";
    before = [ "devenv:enterTest" ];
  };
};
```

Modules register their own tasks the same way — enabling git hooks adds
`devenv:git-hooks:install` as a dependency of `devenv:enterShell`.

## Execution modes

`--mode` decides how much of the graph around the named task is scheduled.

| Mode | Runs |
| --- | --- |
| `single` | only the named task |
| `before` (default) | the task and everything upstream of it |
| `after` | the task and everything downstream of it |
| `all` | the entire connected graph, upstream and downstream |

```bash
devenv tasks run myapp:build                # before mode: build + its dependencies
devenv tasks run myapp:build --mode single  # just build
devenv tasks run myapp:build --mode all     # build, dependencies and dependents
```

Breaking change in 2.1: `devenv tasks run` defaults to `before` mode. Pass `--mode single`
for the pre-2.1 behavior of running only the named task.

`devenv up` also schedules in `before` mode, so a setup task attached *downstream* of a
process (`processes.<name>.before = [ "<namespace>:configure" ]`) is skipped. Use
`devenv up --mode all`. `devenv test` already runs in `all` mode.

## Avoiding needless work

`status` runs first; a zero exit skips `exec`. Skipped tasks restore the outputs of their
last successful run, so dependents still see them.

```nix
tasks."myapp:migrations" = {
  exec = "db-migrate";
  status = "db-needs-migrations";
};
```

`execIfModified` takes glob patterns and tracks both mtime and content hash, so touching a
file without changing it does not re-run the task.

```nix
tasks."myapp:build" = {
  exec = "npm run build";
  execIfModified = [ "src/**/*.ts" "package.json" "src" ];
  cwd = "./frontend";
};
```

## Inputs and outputs

Tasks exchange JSON. The following variables are set in a task's environment:

| Variable | Meaning |
| --- | --- |
| `$DEVENV_TASK_INPUT` | JSON object from this task's `input` |
| `$DEVENV_TASKS_OUTPUTS` | JSON object keyed by dependency task name |
| `$DEVENV_TASK_OUTPUT_FILE` | writable file; write this task's output JSON here |
| `$DEVENV_TASK_EXPORTS_FILE` | writable file; append `name\0base64(value)\0` pairs to export env vars to dependents |
| `$DEVENV_ROOT` | project root |

```nix
tasks."myapp:mytask" = {
  exec = ''
    echo $DEVENV_TASK_INPUT > $DEVENV_ROOT/input.json
    echo '{ "output": 1 }' > $DEVENV_TASK_OUTPUT_FILE
    echo $DEVENV_TASKS_OUTPUTS > $DEVENV_ROOT/outputs.json
  '';
  input = { value = 1; };
};
```

### Shell messages

A task that runs before `devenv:enterShell` can print messages after the environment loads
by writing a `devenv.messages` array to `$DEVENV_TASK_OUTPUT_FILE`:

```nix
tasks."myapp:info" = {
  exec = ''
    echo '{"devenv":{"messages":["Setup complete. Dashboard: http://localhost:3000"]}}' \
      > "$DEVENV_TASK_OUTPUT_FILE"
  '';
  before = [ "devenv:enterShell" ];
};
```

## A task can be a process

Set `type = "process"` to have the process manager supervise a task; the supervision knobs
then live under `tasks.<name>.process.*` and mirror the `processes.<name>` options:
`ports`, `ready` (`exec`, `http.get.{host,path,port,scheme}`, `notify`, `initial_delay`,
`period`, `probe_timeout`, `timeout`, `success_threshold`, `failure_threshold`), `restart`
(`on`, `max`, `window`), `start.enable`, `watch` (`paths`, `extensions`, `ignore`),
`watchdog` (`usec`, `require_ready`), `listen` (`name`, `kind`, `address`, `path`, `mode`,
`backlog`) and `linux.capabilities`. `exec`, `cwd` and `env` stay on the task itself.

```nix
tasks."myapp:server" = {
  exec = "node server.js";
  type = "process";
  process.restart.on = "always";
  process.ready.http.get = { port = 3000; path = "/healthz"; };
};
```

For anything you would otherwise write as a plain long-running service, prefer
`processes.<name>` — it is the same machinery with a shorter path.

## Other interpreters

```nix
tasks."python:hello" = {
  exec = ''print("Hello world from Python!")'';
  package = config.languages.python.package;
};
```

## Monorepo paths

```nix
tasks."build:frontend" = {
  exec = "npm run build";
  cwd = "${config.git.root}/frontend";
};
```

## CLI

```bash
devenv tasks list                       # all tasks with descriptions
devenv tasks list --json                # machine-readable (2.2+)
devenv tasks run <namespace>:<name>     # one task, `before` mode
devenv tasks run <namespace>            # every task in a namespace
devenv tasks run <namespace>:<name> --mode single|before|after|all
devenv tasks run <namespace>:<name> --input value=42 --input name=hello
devenv tasks run <namespace>:<name> --input-json '{"value": 42}'
devenv tasks run <namespace>:<name> --show-output
```

`--input` values parse as JSON when valid, otherwise as strings. `--input-json` is applied
first and individual `--input` values merge on top; CLI values win over Nix-defined `input`.
`--refresh-task-cache` (global flag) forces re-running cached tasks.

https://devenv.sh/tasks/
