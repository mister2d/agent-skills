# Secrets with SecretSpec

SecretSpec separates *declaring* which secrets a project needs from *provisioning*
them. Declarations live in a committed `secretspec.toml`; values come from each
developer's, CI's, or production's own provider. devenv 2.2.1 bundles the
`secretspec` CLI (version 0.17.1) — no separate install.

## The never-in-env rule

Never put a credential in `env = { }` in `devenv.nix`. `env` values are baked
into the Nix store, land in every process the shell spawns, and leak to any agent
or subprocess that inherits the environment. `env` is for non-secret
configuration: ports, feature flags, service URLs.

Two access patterns, in order of preference:

1. **Runtime injection (recommended).** Secrets reach only the process that needs
   them, for as long as it runs.

   ```bash
   devenv shell
   secretspec run -- npm start
   secretspec run --profile production -- ./deploy.sh
   ```

2. **Evaluation-time lookup.** Available when the integration is enabled, but the
   value becomes part of the environment:

   ```nix
   { config, ... }:

   {
     env.DATABASE_URL = config.secretspec.secrets.DATABASE_URL or "";
   }
   ```

   Use this only when a devenv option genuinely requires the value at evaluation
   time. `config.secretspec.{enable,profile,provider,secrets}` are all read-only.

## Enabling it in devenv.yaml

```yaml
# yaml-language-server: $schema=https://devenv.sh/devenv.schema.json

secretspec:
  enable: true
  provider: keyring
  profile: default
```

| Option | Type | Default | Description |
|---|---|---|---|
| `secretspec.enable` | boolean | `false` | Enable the integration. Added in 1.8. |
| `secretspec.provider` | string | unset | Provider id. |
| `secretspec.profile` | string | unset | Profile name from `secretspec.toml`. |
| `secretspec.cachix_auth_token` | boolean or string | unset | Require the Cachix token through SecretSpec when `CACHIX_AUTH_TOKEN` is not already set. Added in 2.2. |

A project that ships `secretspec.toml` without `secretspec.enable: true` has inert
declarations — always pair them.

When the integration is on, devenv exports `SECRETSPEC_PROFILE` and
`SECRETSPEC_PROVIDER` into the shell, so a bare `secretspec run` inside the shell
resolves with exactly the configuration devenv used while evaluating `devenv.nix`.

The integration is unsupported when devenv is consumed through the Nix flakes
integration — the devenv CLI is required to load the secrets.

### CLI overrides

```bash
devenv --secretspec-provider dotenv --secretspec-profile dev shell
SECRETSPEC_PROVIDER=dotenv SECRETSPEC_PROFILE=dev devenv shell
```

Both flags read from the matching environment variable, take precedence over
`devenv.yaml`, and passing either one automatically enables the integration.

### cachix_auth_token (2.2)

```yaml
secretspec:
  enable: true
  provider: keyring
  cachix_auth_token: true            # built-in CACHIX_AUTH_TOKEN secret
```

`true` requires the built-in `CACHIX_AUTH_TOKEN` secret with no declaration in
`secretspec.toml`. A string renames only the SecretSpec lookup — useful when a
Vault/OpenBao policy grants the token under a different path:

```yaml
secretspec:
  enable: true
  provider: openbao
  cachix_auth_token: MY_TEAM_CACHIX_TOKEN
```

The string is a secret *name*, not the token. The environment variable and the
Cachix push daemon still use `CACHIX_AUTH_TOKEN`. `false` or omitting the key
disables the built-in requirement. Falls back to the token stored by
`cachix authtoken` when `CACHIX_AUTH_TOKEN` is already in the environment.

https://devenv.sh/integrations/secretspec/

## secretspec.toml

Commit this file. It declares names, never values.

```toml
[project]
name = "myapp"
revision = "1.0"          # required, must be "1.0"

[profiles.default]
DATABASE_URL  = { description = "PostgreSQL DSN", required = true }
STRIPE_SECRET = { description = "Stripe secret key", required = true }
REDIS_URL     = { description = "Redis cache", required = false, default = "redis://localhost:6379" }
SENTRY_DSN    = { description = "Sentry DSN", required = false }

[profiles.production]
DATABASE_URL  = { required = true }   # description inherited from default
```

`[project]` fields: `name` (required), `revision` (required, `"1.0"`), `extends`
(list of paths to parent configs), `require_reason` (`"agents"` by default —
demand a `--reason` when the caller looks like an AI agent; `true` demands one
from everybody; `false` never).

Per-secret fields: `description`, `required` (boolean, or a table form with
`at_least_one` / `exactly_one` presence groups since 0.17), `default`, `as_path`
(materialize the value to a file and expose the path). Non-`default` profiles
inherit declarations and omitted fields from `[profiles.default]`.
`[profiles.<name>.defaults]` sets profile-wide `required`, `default`, and
`providers` fallback chains.

### Generation

Secrets that need not be shared between developers can be generated on first use:

```toml
[profiles.default]
DB_PASSWORD = { description = "Database password", type = "password", generate = true }
API_TOKEN   = { description = "API token",        type = "hex",      generate = { bytes = 32 } }
SESSION_KEY = { description = "Session key",      type = "base64",   generate = { bytes = 64 } }
REQUEST_ID  = { description = "Request id",       type = "uuid",     generate = true }
WG_KEY      = { description = "WireGuard key",    type = "command",  generate = { command = "wg genkey" } }
```

| `type` | Default output | Options |
|---|---|---|
| `password` | 32 alphanumeric chars | `length` (int), `charset` (`"alphanumeric"` or `"ascii"`) |
| `hex` | 64 hex chars (32 bytes) | `bytes` (int) |
| `base64` | 44 chars (32 bytes) | `bytes` (int) |
| `uuid` | UUID v4 | none |
| `command` | stdout of the command | `command` (string, required) |
| `rsa_private_key` | 2048-bit PKCS1 PEM | `bits` (int) |

`generate = true` uses the type's defaults; the table form supplies options.

## Providers

Provider ids available in the 0.17.x line that devenv 2.2.1 bundles:

| Id | Backend |
|---|---|
| `keyring` | OS keychain — macOS Keychain, Secret Service, Windows Credential Manager. Recommended default. |
| `onepassword` | 1Password |
| `lastpass` | LastPass |
| `bws` | Bitwarden Secrets Manager (custom/self-hosted instances supported) |
| `vault` | HashiCorp Vault |
| `openbao` | OpenBao (0.17+) |
| `awssm` | AWS Secrets Manager (supports key prefixes) |
| `gcsm` | Google Cloud Secret Manager |
| `akv` | Azure Key Vault |
| `scaleway` | Scaleway Secret Manager (0.17+) |
| `infisical` | Infisical |
| `sops` | SOPS-encrypted files (0.17+) |
| `age` | age-encrypted file (0.17+) |
| `kdbx` | KeePass KDBX database (0.17+) |
| `gopass` | gopass |
| `pass` | pass (GPG) |
| `protonpass` | Proton Pass |
| `systemd-credential` | systemd service credentials, read-only (0.17+) |
| `dotenv` | `.env` file — last resort; avoid in agent environments |
| `env` | Ambient environment variables |

Cumulative additions since the 0.10.1 that devenv 2.1 shipped: audit logging and
coding-agent detection, secret references, provider credentials, composed
secrets, and in 0.17 scopes, secret caching (`secretspec cache clear`), and the
`age`/`sops`/`kdbx`/`openbao`/`scaleway`/`systemd-credential` providers.

Useful commands: `secretspec init --from dotenv://.env` to bootstrap declarations
from an existing `.env`, `secretspec config global init` to pick a user-wide
default provider, `secretspec check` to verify everything resolves, and
`secretspec run --reason "<why>" -- <cmd>` when `require_reason` is in force.

https://secretspec.dev
