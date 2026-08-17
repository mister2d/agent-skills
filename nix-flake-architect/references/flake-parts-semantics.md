# flake-parts Semantics

How flake-parts evaluates a flake, why a module can contribute nothing without
producing an error, and which module arguments exist where. Read before writing a
flake-parts module.

> Source: flake-parts `modules/perSystem.nix`, `modules/nixpkgs.nix`, `modules/debug.nix`,
> `modules/withSystem.nix`; nixpkgs `lib/modules.nix`. Behavior verified against
> flake-parts `427bf4bd` (2026-08-01) and nixpkgs `e5bdc4a4`.

## Table of Contents

1. [The evaluation model](#1-the-evaluation-model)
2. [Why an empty perSystem contribution is silent](#2-why-an-empty-persystem-contribution-is-silent)
3. [Module anatomy: three correct shapes](#3-module-anatomy-three-correct-shapes)
4. [Module argument scope](#4-module-argument-scope)
5. [Crossing the boundary: withSystem and getSystem](#5-crossing-the-boundary-withsystem-and-getsystem)
6. [Inspecting the merged result: debug = true](#6-inspecting-the-merged-result-debug--true)

---

## 1. The evaluation model

`mkFlake` runs `evalModules` over the top-level modules. Flake outputs come from two
distinct places:

- **`flake.*`** — not system-scoped. `nixosConfigurations`, `nixosModules`, `overlays`,
  `lib`, `templates`.
- **`perSystem`** — evaluated once per entry in `systems`, producing the system-scoped
  outputs: `packages`, `devShells`, `apps`, `checks`, `formatter`, `legacyPackages`.

`perSystem` is not an ordinary attribute. It is declared as a **deferred module**: its
`merge` collects every definition into a *list of modules*, and its `apply` runs a fresh
`evalModules` per system with `class = "perSystem"`. Every `perSystem = …` written
anywhere in the module tree is one more module in that list.

Two consequences follow, and between them they account for most flake-parts failures.
`perSystem` definitions never conflict — they merge — and a definition that yields
nothing is indistinguishable from a definition that was never written.

---

## 2. Why an empty perSystem contribution is silent

A `perSystem` definition is a *module*, not a value. The module system has no concept
of an "empty" module to warn about: a module defining nothing and a module that does
not exist produce identical results.

`lib.mkIf false { … }` used as an entire module body is legal. nixpkgs' `loadModule`
rewrites any value whose `_type` is `"if"` into `{ config = <that value>; }`, so a
false `mkIf` becomes a module that defines nothing. There is no error path.

Writing the guard inside the returned attrset instead — `{ packages = lib.mkIf cond { … }; }`
— is equally legal and equally silent. **Moving the `mkIf` is never the fix.** The fix is
to establish that the condition is true, or to delete the condition.

The same outcome arrives by four other routes, none of which produce a diagnostic:

| Cause | Why nothing is reported |
|---|---|
| `mkIf` / `optionalAttrs` / `lib.optionals` guard is false | evaluates to a module defining nothing |
| An `enable` option declared `default = false` that nothing sets to `true` | the guard above, one level removed |
| The module file is missing from a hand-written `imports` list | the module is never loaded |
| The file path contains `/_` and `import-tree` skips it | the module is never loaded |
| `systems` does not list the system being queried | `perSystem` is never evaluated for it |

Guarded output, as observed: `nix flake show` prints the flake's URL line and nothing
else — no `packages` node, no system key. `nix eval .#packages.<system> --apply
builtins.attrNames` returns `[ ]` and exits `0`.

The one shape that *does* error is a definition placed outside `perSystem`:

```
error: The option `packages' does not exist. Definition values:
- In `/nix/store/…-source/modules/tlpkgs.nix':
    {
      x = 1;
    }

Did you mean `flake', `debug' or `perInput'?
```

So silence is itself diagnostic: it means the definition *is* inside `perSystem` and
evaluated to nothing. See `troubleshooting.md` for the full diagnosis ladder.

---

## 3. Module anatomy: three correct shapes

### Shape A — unconditional

Use this unless the feature is genuinely optional. It cannot fail silently.

```nix
# modules/my-feature.nix
_: {
  perSystem = { pkgs, ... }: {
    packages.my-feature = pkgs.callPackage ./pkgs/my-feature { };
  };
}
```

### Shape B — opt-in

Both halves are required. The module on its own contributes nothing.

```nix
# modules/my-feature.nix
{ lib, flake-parts-lib, ... }:
{
  options.perSystem = flake-parts-lib.mkPerSystemOption {
    options.myFeature.enable = lib.mkEnableOption "the my-feature package";
  };

  # `config` here is the perSystem config, so `config.myFeature.enable` is the option
  # declared directly above — not a top-level option of the same name.
  config.perSystem = { config, pkgs, ... }:
    lib.mkIf config.myFeature.enable {
      packages.my-feature = pkgs.callPackage ./pkgs/my-feature { };
    };
}
```

```nix
# The companion. Without it, mkEnableOption leaves the option false, mkIf yields a
# module that defines nothing, flake-parts merges it, and the flake evaluates cleanly
# with no my-feature package and no diagnostic.
# In flake.nix or any other flake-parts module:
_: {
  perSystem = { myFeature.enable = true; };
}
```

When writing Shape B, write the companion in the same change. An opt-in module whose
option nothing sets is dead code that looks like working code.

### Shape C — options only

A module that declares options for other modules to read, contributing no outputs
itself. Its `perSystem` is legitimately empty, so exclude it when auditing for
missing outputs.

```nix
{ lib, flake-parts-lib, ... }:
{
  options.perSystem = flake-parts-lib.mkPerSystemOption {
    options.myProject.version = lib.mkOption {
      type = lib.types.str;
      default = "0.1.0";
    };
  };
}
```

---

## 4. Module argument scope

| Argument | Top-level module | `perSystem` module |
|---|---|---|
| `config`, `options`, `lib` | yes — top-level config | yes — perSystem config |
| `inputs`, `self` | yes | no — flake-parts throws, naming `inputs'` / `self'` |
| `withSystem`, `getSystem`, `moduleWithSystem` | yes | no |
| `flake-parts-lib` | yes | no |
| `pkgs` | **no** | yes |
| `system`, `inputs'`, `self'` | no | yes |

`pkgs` is supplied by flake-parts' nixpkgs module, whose source comment states its scope
outright — *"Provides a `pkgs` argument in `perSystem`."* It sets
`perSystem._module.args.pkgs` from `inputs'.nixpkgs.legacyPackages`, and defines nothing
at the top level.

Referencing `pkgs` in a top-level module gets no helpful message, because flake-parts
never declares it there. The module system falls back to `config._module.args.pkgs`,
which is absent:

```
… while evaluating the module argument `pkgs' in "/nix/store/…-source/modules/probe.nix":
… noting that argument `pkgs` is not externally provided, so querying `_module.args` instead, requiring `config`
error: attribute 'pkgs' missing
```

Referencing `self` or `inputs` inside `perSystem` is caught properly — flake-parts
raises a dedicated error naming the primed alias:

```
error: `self` (without `'`) is not a `perSystem` module argument, but a
module argument of the top level config.
```

**Both errors are lazy.** A wrong argument only throws when something forces the value
that uses it. `nix eval .#packages.<system> --apply builtins.attrNames` reports
attribute *names* without forcing their contents, so a module with a bad `pkgs`
reference still lists its package there. Presence is not buildability — force the value
(`nix eval .#packages.<system>.<name>.outPath`, or `nix build`) to surface these.

**Build derivations inside `perSystem`.** A `let app = pkgs.stdenv.mkDerivation …` at the
top level of a module is the common form of this mistake.

---

## 5. Crossing the boundary: withSystem and getSystem

When a `flake.*` output genuinely needs a package — a `nixosConfigurations` entry, a
`flake.lib` helper — reach into a system rather than pulling `pkgs` outward:

```nix
top@{ withSystem, ... }: {
  flake.packages.x86_64-linux.thing =
    withSystem "x86_64-linux" ({ pkgs, ... }: pkgs.hello);
}
```

`withSystem` is `system: f: f (getSystem system).allModuleArgs`, so `f` receives exactly
the argument set a `perSystem` module would — `pkgs`, `system`, `inputs'`, `self'`, and
the perSystem `config`.

`moduleWithSystem` is the equivalent for producing a NixOS or home-manager module that
needs packages from a particular system.

---

## 6. Inspecting the merged result: debug = true

flake-parts ships a debug module. Setting `debug = true;` in any flake-parts module adds
`debug`, `allSystems`, and `currentSystem` to the flake's outputs, exposing the merged
configuration that produced (or failed to produce) your outputs.

```bash
nix eval .#allSystems.x86_64-linux.packages --apply builtins.attrNames   # merged perSystem outputs
nix eval .#debug.config.systems                                          # the resolved systems list
nix eval .#allSystems.x86_64-linux.myFeature.enable                      # a guard option's actual value
```

That last form is the fastest route to a silent-empty diagnosis: it reads the guard
directly and returns `false` rather than leaving you to infer it.

Remove `debug = true` afterwards — it adds non-standard attributes to the flake's public
output set.
