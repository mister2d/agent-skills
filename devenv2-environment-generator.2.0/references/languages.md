# Language Configuration Reference

## Python

```nix
languages.python = {
  enable = true;
  version = "3.12";          # Pin version; omit to use nixpkgs default
  venv.enable = true;        # Activates virtualenv automatically
  venv.requirements = ./requirements.txt;
  uv.enable = true;          # Use uv instead of pip (recommended 2.0+)
  lsp.enable = true;         # pyright
};
```

## Node / TypeScript

```nix
languages.javascript = {
  enable = true;
  package = pkgs.nodejs_22;
  npm.enable = true;         # or: yarn, pnpm
  corepack.enable = true;
};
languages.typescript.enable = true;   # tsc + tsserver LSP
```

## Rust

```nix
languages.rust = {
  enable = true;
  channel = "stable";        # "stable" | "beta" | "nightly"
  components = [ "rustfmt" "clippy" "rust-analyzer" ];
  lsp.enable = true;
};
```

## Go

```nix
languages.go = {
  enable = true;
  package = pkgs.go_1_22;
  lsp.enable = true;         # gopls
};
```

## Java / JVM

```nix
languages.java = {
  enable = true;
  jdk.package = pkgs.jdk21;
  maven.enable = true;       # or: gradle.enable
};
```

## Other supported languages

devenv supports 50+ languages. The pattern is consistent:

```nix
languages.<lang>.enable = true;
# Plus optional: package, lsp, ecosystem tooling
```

Full list: ansible, c, clojure, cplusplus, crystal, cue, dart, deno, dotnet,
elixir, elm, erlang, fortran, gawk, gleam, go, hare, haskell, helm, idris,
java, javascript, jsonnet, julia, kotlin, lean4, lua, nim, nix, ocaml, odin,
opentofu, pascal, perl, php, purescript, python, r, racket, raku,
robotframework, ruby, rust, scala, shell, solidity, standardml, swift,
terraform, texlive, typescript, typst, unison, v, vala, zig.

## LSP per language

```nix
languages.python.lsp.enable = true;       # pyright
languages.rust.lsp.enable = true;         # rust-analyzer
languages.go.lsp.enable = true;           # gopls
languages.javascript.lsp.enable = true;   # tsserver
languages.nix.lsp.enable = true;          # nil or nixd
```

Enable `devenv lsp` for `devenv.nix` completion and diagnostics in your editor.
