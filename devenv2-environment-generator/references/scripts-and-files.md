# Scripts, Files and Environment Reference

Covers the devenv.nix namespaces that put things into the developer's shell rather than
supervising them: `scripts.*`, `files.*`, `env`, `dotenv`, `hosts` and the mkcert
(`certificates` / `certFile` / `keyFile`) integration. For long-running work see
`processes.md`; for ordered setup steps see `tasks.md`; for secret material see `secrets.md`.

## scripts

`scripts.<name>` defines a command available on `PATH` whenever the environment is active.
Prefer a script over a raw shell alias: it is reproducible, gets its own dependencies, and is
listed on shell entry.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `exec` | string or path | (required) | Shell code to run, or a path to a script file |
| `packages` | list of package | `[ ]` | Packages on `PATH` only while the script runs |
| `package` | package | `pkgs.bash` | Interpreter used to execute `exec` |
| `binary` | null or string | `null` | Override `package.meta.mainProgram` |
| `description` | string | `""` | Help text; surfaced on shell entry |

```nix
scripts.<name> = {
  exec = ''...'';
  packages = [ pkgs.curl ];
  description = "Help text";
};
```

Arguments are forwarded, so `"$@"` works:

```nix
scripts.fetch-json = {
  exec = ''
    curl "https://httpbin.org/get?$1" | jq '.args'
  '';
  packages = [ pkgs.curl pkgs.jq ];   # not added to the global environment
  description = "Fetch and analyze JSON";
};
```

`packages` keeps tooling scoped to the script. The alternative — interpolating store paths
directly (`${pkgs.jq}/bin/jq`) — also works and pins the exact package.

### Alternate interpreters

Set `package` to run `exec` under something other than bash, and `binary` when the package's
main program is not the one you want.

```nix
scripts.nushell-greet = {
  exec = ''
    def greet [name] {
      ["hello" $name]
    }
    greet "world"
  '';
  package = pkgs.nushell;
  binary = "nu";                      # explicit interpreter binary; defaults to package.meta.mainProgram
  description = "Greet in Nu Shell";
};

scripts.python-hello = {
  exec = ''
    print("Hello, world!")
  '';
  package = config.languages.python.package;
  description = "hello world in Python";
};
```

`exec` also accepts a path, which keeps large scripts out of devenv.nix. Since 2.2 such
store-path files are tracked as evaluation-cache dependencies, so edits are picked up:

```nix
scripts.file-example = {
  exec = ./file-script.sh;
  description = "Script loaded from external file";
};
```

Scripts and their descriptions are registered in devenv's info sections and printed when the
environment is entered — write a real `description` for every script you generate.

https://devenv.sh/scripts/

## files

`files."<name>"` materializes a file in the project root from Nix data — the attribute name is
the path relative to the project root. Exactly one content
attribute is set per file.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `text` | null or string | `null` | Plain text contents |
| `json` | null or JSON value | `null` | Rendered as JSON |
| `yaml` | null or YAML value | `null` | Rendered as YAML 1.1 |
| `toml` | null or TOML value | `null` | Rendered as TOML |
| `ini` | null or INI attrset | `null` | Rendered as INI (section → key → atom) |
| `source` | null or path | `null` | Copy contents from an existing path |
| `executable` | boolean | `false` | Set the executable bit |
| `copyMode` | `"symlink"` \| `"seed"` \| `"copy"` | `"symlink"` | How the file is materialized |

```nix
files."config.json".json = {
  database = { host = "localhost"; port = 5432; };
  features = [ "auth" "api" "ui" ];
};

files."settings.ini".ini = {
  general = { debug = "true"; log_level = "info"; };
};

files."scripts/build.sh" = {
  text = "#!/bin/bash\nnpm run build";
  executable = true;
};
```

Nested paths work directly — parent directories are created automatically:

```nix
files.".config/app/settings.json".json = { theme = "dark"; };
```

### Copy modes

`copyMode` was added in 2.2 and decides whether the file is editable.

- `symlink` (default) — symlink to the read-only Nix store path. Not editable; devenv keeps
  the link pointed at current contents.
- `seed` — copy into place once, only if absent, and make it writable. Existing files are
  left alone, so user edits survive. Use for templates the developer is meant to edit.
- `copy` — copy into place as a writable file, overwritten with fresh contents on every
  shell entry. Use when a tool must write to the file in place but devenv stays the source
  of truth.

```nix
files.".env.local" = {
  copyMode = "seed";                  # never clobbers a developer's edits
  text = ''
    API_URL=http://localhost:8080
  '';
};

files."config/generated.toml" = {
  copyMode = "copy";                  # regenerated every shell entry
  toml.server.port = 8000;
};
```

Generated files belong in `.gitignore` unless the team intends to commit them.

https://devenv.sh/creating-files/

## env

`env` is an attribute set exposed in the shell and inherited by processes and tasks.

```nix
env = { KEY = "value"; };             # non-secret values only
```

Values are written into the environment at evaluation time and end up in the Nix store, so
never put API keys, tokens or passwords here. Use SecretSpec instead — see `secrets.md`.
Per-process and per-task overrides live at `processes.<name>.env` and `tasks.<name>.env`.

## dotenv

`.env` support exists but is legacy: the file is read during evaluation with `readFile`, so
its contents are copied into the Nix store and become world-readable. Reach for SecretSpec
(`secrets.md`) for anything sensitive; use `dotenv` only for non-secret local overrides.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `dotenv.enable` | boolean | `false` | Load the dotenv file(s) into `env` |
| `dotenv.filename` | string or list of string | `".env"` | File, or files in precedence order |
| `dotenv.disableHint` | boolean | `false` | Silence the hint shown when a `.env` exists but the module is off |

```nix
dotenv.enable = true;
dotenv.filename = [ ".env" ".env.local" ];
```

Filenames must start with `.env` — devenv asserts this. Comments and multiline values are
not supported by the parser.

https://devenv.sh/integrations/dotenv/

## hosts

`hosts` writes `/etc/hosts` entries through `hostctl`, under a per-project profile.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `hosts` | attrset of (string or list of string) | `{ }` | hostname → IP or list of IPs |
| `hostsProfileName` | string | `devenv-<hash>` | hostctl profile name |

```nix
hosts = {
  "example.com" = "127.0.0.1";
  "another-example.com" = [ "::1" "127.0.0.1" ];
};
```

Applying entries runs `sudo hostctl`, so it prompts for a password and fails on read-only
`/etc/hosts` (e.g. NixOS). The setup task is wired as a soft dependency, so processes still
start when it fails. Avoid generating `hosts` in non-interactive or CI environments.

## certificates (mkcert)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `certificates` | list of string | `[ ]` | Domains to issue certificates for |
| `certFile` | null or string | `null` | Certificate file name (mkcert default if unset) |
| `keyFile` | null or string | `null` | Key file name (mkcert default if unset) |

```nix
certificates = [ "example.com" "*.example.com" ];
certFile = "mycert.pem";
keyFile = "mykey.pem";
```

A local CA is installed on first use and certificates are written to
`$DEVENV_STATE/mkcert`, regenerated whenever the domain list changes. devenv sets
`CAROOT` and `NODE_EXTRA_CA_CERTS` so Node and mkcert-aware tooling trust the CA. The setup
runs as `devenv:mkcert:setup` before every process task.
