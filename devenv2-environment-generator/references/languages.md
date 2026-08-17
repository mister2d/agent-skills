# Language Configuration Reference

Per-language `languages.*` options for the toolchains this skill generates most often, plus
the shared conventions (`lsp.*`, `directory`, `import`) that apply across modules. Every
option path below was confirmed against https://devenv.sh/reference/options/ for devenv 2.2.1.

## Shared shape

Every language module follows the same pattern:

```nix
languages.<lang>.enable = true;     # the only required attribute
# then, where the module defines them:
#   package / version       pick the toolchain derivation
#   lsp.enable / lsp.package  language server (see "LSP per language")
#   directory               project root when it is not the devenv root
#   import                  packaging function -> outputs (rust, python)
#   ecosystem tooling       venv/uv/poetry, npm/pnpm/yarn/bun, maven/gradle, ...
```

`version` (where present) selects the toolchain through an overlay and sets `package` for you;
`package` is the escape hatch when you need an exact derivation. Do not set both.

## Python

```nix
languages.python = {
  enable = true;
  version = "3.12";           # null by default; sets package via nixpkgs-python
  directory = ".";            # defaults to config.devenv.root
  venv.enable = true;         # creates and activates a virtualenv
  venv.requirements = ./requirements.txt;   # null | inline lines | absolute path
  uv.enable = true;           # default false; uv is the recommended installer
  uv.sync.enable = true;      # default false; `uv sync` on shell entry
  # poetry.enable = true;     # alternative ecosystem
  # poetry.install.enable = true;
  # libraries = [ pkgs.zlib ];  # native libs for binary wheels
  lsp.package = pkgs.pyright; # lsp.enable is already true
};
```

`uv.sync` has fine-grained selectors — `packages`, `allPackages`, `extras`, `allExtras`,
`groups`, `allGroups`, `arguments`. `poetry.install` mirrors them with `groups`, `onlyGroups`,
`ignoredGroups`, `extras`, `allExtras`, `installRootPackage`, `compile`, `verbosity`.

## Node / TypeScript

```nix
languages.javascript = {
  enable = true;
  package = pkgs.nodejs_22;   # default pkgs.nodejs-slim
  directory = ".";            # defaults to config.devenv.root
  npm.enable = true;          # or pnpm.enable / yarn.enable / bun.enable
  npm.install.enable = true;  # install on shell entry (each manager has .install.enable)
  corepack.enable = true;     # manage package managers through corepack
  # nodejs.enable = false;    # drop the runtime when the manager supplies it
};

languages.typescript.enable = true;   # tsc; its own lsp.enable/lsp.package
```

`languages.javascript.lsp.package` defaults to `pkgs.typescript-language-server` and serves
both JavaScript and TypeScript projects.

## Rust

```nix
languages.rust = {
  enable = true;
  channel = "stable";         # "nixpkgs" (default) | "stable" | "beta" | "nightly"
  version = "latest";         # only honoured when channel != "nixpkgs"
  components = [ "rustc" "cargo" "clippy" "rustfmt" "rust-analyzer" ];   # this is the default
  targets = [ ];              # extra cross-compilation targets; native only by default
  # toolchainFile = ./rust-toolchain.toml;   # take the toolchain from the repo file
  # mold.enable = true;       # or lld.enable / wild.enable — pick exactly one linker
  # rustflags = "-C target-cpu=native";
};
```

`lsp.package` resolves from the configured toolchain: `pkgs.rust-analyzer` on the `nixpkgs`
channel, otherwise the `rust-analyzer` component from the rust-overlay toolchain.

## Go

```nix
languages.go = {
  enable = true;
  version = "1.22.0";         # null by default; sets package via go-overlay
  # package = pkgs.go;        # alternative to version
  delve.enable = true;        # dlv debugger
  # enableHardeningWorkaround = true;   # only for cgo builds that trip hardening
};
```

## Java / JVM

```nix
languages.java = {
  enable = true;
  jdk.package = pkgs.jdk21;   # default pkgs.jdk; also exported as JAVA_HOME
  maven.enable = true;        # or gradle.enable = true;
  # maven.package / gradle.package to pin the build tool
};
```

`lsp.package` defaults to `pkgs.jdt-language-server`.

## Elixir

```nix
languages.elixir = {
  enable = true;
  package = pkgs.elixir;
  # lsp.package defaults to pkgs.elixir-ls
};
```

Erlang is a separate module (`languages.erlang.enable`); enable it when you need `erl`/`rebar3`
alongside Elixir.

## LSP per language

`languages.<lang>.lsp.enable` **defaults to `true`** wherever the module defines it — the
language server ships as soon as you enable the language. There is no top-level `lsp.enable`.
So `lsp.enable = true` is redundant; write it only when you want the intent recorded in the
file. The two useful settings are the opt-out and the package override:

```nix
languages.python.lsp.enable = false;      # opt out: skip pyright entirely
languages.rust.lsp.package = pkgs.rust-analyzer;   # override the server derivation
```

Modules that define `lsp.*` include ansible, c, clojure, cplusplus, crystal, cue, dotnet,
elixir, elm, erlang, fortran, go, haskell, helm, idris, java, javascript, jsonnet, kotlin,
lua, nim, nix, ocaml, odin, opentofu, perl, php, pkl, purescript, python, r, ruby, rust,
scala, shell, standardml, swift, terraform, texlive, typescript, typst, vala, zig. The rest
(dart, deno, gleam, julia, and friends) ship their tooling through `package` only.

Separately, `devenv lsp` starts nixd against `devenv.nix` itself so your editor completes and
diagnoses devenv options. That is unrelated to `languages.<lang>.lsp.*`.

## Packaging: languages.<lang>.import

Two modules expose an `import` function that turns a source directory into a derivation.
Both take a path and an attrset of overrides, and both are meant to be wired into `outputs`:

```nix
# Rust — crate2nix, needs a Cargo.toml in the directory
outputs.my-app = config.languages.rust.import ./app { };

# Python — uv2nix, needs a pyproject.toml in the directory
outputs.my-service = config.languages.python.import ./. { };
```

The result is an ordinary package, so it can also go straight into `packages`:

```nix
{ pkgs, config, ... }:
let mypackage = config.languages.rust.import ./app { };
in {
  languages.rust.enable = true;
  packages = [ mypackage ];
}
```

Since 2.2 these store-path arguments are tracked as eval-cache dependencies, so editing the
sources invalidates the cache instead of serving a stale build. Build with `devenv build` (all
outputs) or `devenv build outputs.my-app`; see `outputs-containers-testing.md` for the output
JSON format, container targets, and how outputs feed `devenv test`.

## All supported languages

devenv 2.2.1 ships **58** language modules. The index page markets "60+"; the module and page
count is 58.

```nix
languages.<lang>.enable = true;
```

ansible, c, clojure, cplusplus, crystal, cue, dart, deno, dotnet, elixir, elm, erlang,
fortran, gawk, gleam, go, hare, haskell, helm, idris, java, javascript, jsonnet, julia,
kotlin, lean4, lobster, lua, nim, nix, ocaml, odin, opentofu, pascal, perl, php, pkl,
purescript, python, r, racket, raku, robotframework, ruby, rust, scala, shell, solidity,
standardml, swift, terraform, texlive, typescript, typst, unison, v, vala, zig.

Per-language pages live at https://devenv.sh/languages/<lang>/; the authoritative option list
is https://devenv.sh/reference/options/
