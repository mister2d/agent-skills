# Troubleshooting Flakes

Match the symptom, not the guess. Every error string below was captured from a real
run against flake-parts `427bf4bd` and nixpkgs `e5bdc4a4`; if your output differs,
trust your output.

## Table of Contents — symptom index

| What you see | Section |
|---|---|
| Flake evaluates, exits 0, produces no packages or devShells | [1](#1-the-flake-evaluates-but-produces-nothing) |
| `error: attribute 'pkgs' missing` | [2](#2-error-attribute-pkgs-missing) |
| ``error: `self` (without `'`) is not a `perSystem` module argument`` | [3](#3-self-or-inputs-is-not-a-persystem-module-argument) |
| ``error: The option `packages' does not exist`` | [4](#4-error-the-option-packages-does-not-exist) |
| `error: flake … does not provide attribute 'packages.<system>'` | [5](#5-flake-does-not-provide-attribute-packagessystem) |
| `cp: cannot stat '<dir>/<file>'` during a build | [6](#6-cp-cannot-stat--src-layout) |
| A file you just created has no effect | [7](#7-a-new-file-has-no-effect) |
| `error: infinite recursion encountered` | [8](#8-error-infinite-recursion-encountered) |
| `nix flake check` passes but `nix build` fails | [9](#9-nix-flake-check-passes-but-nix-build-fails) |

---

## 1. The flake evaluates but produces nothing

The defining feature of this failure is that **there is no error**. Exit status is `0`.
With a fully guarded `perSystem`, `nix flake show` prints only the flake's URL line —
no `packages` node, not even the system key:

```
$ nix flake show
git+file:///home/you/project
$ echo $?
0
```

Work the ladder in order. Do not skip to step 3.

**Step 1 — ask the flake what it produced**, rather than reading the tree `nix flake show`
renders.

```bash
nix eval .#packages.x86_64-linux --apply builtins.attrNames
# [ ]   -> perSystem contributed nothing for this system. Exit status is 0.
```

**Step 2 — confirm the system is enumerated at all.**

```bash
nix eval .#packages --apply builtins.attrNames
# [ "x86_64-linux" ]   -> the system is present; the problem is inside perSystem
# [ ]                  -> `systems` is empty or missing; go to section 5
```

**Step 3 — find the module that should have contributed**, with
`grep -rn perSystem modules/`, and check these in order:

- **Is the definition guarded?** `mkIf`, `optionalAttrs`, `lib.optionals`, or an `enable`
  option declared `default = false` that nothing sets to `true`. The most common cause by
  a wide margin, and the only one with no diagnostic anywhere. An opt-in module needs a
  companion `perSystem = { myFeature.enable = true; };` somewhere — the module alone
  contributes nothing.
- **Is the file reachable?** `import-tree` skips any path containing `/_`, so renaming
  `site.nix` to `_site.nix` silently removes its outputs. A hand-written `imports` list
  needs the file listed. Is the file tracked by git (section 7)?
- **Is the definition inside `perSystem`?** A top-level `packages = { … }` *does* error
  (section 4). Silence means the definition is inside `perSystem` and evaluated to nothing.

**Step 4 — read the merged value directly.** Add `debug = true;` to any flake-parts
module. This is the fastest way to see a guard's real value instead of inferring it:

```bash
nix eval .#allSystems.x86_64-linux.packages --apply builtins.attrNames   # merged outputs
nix eval .#allSystems.x86_64-linux.myFeature.enable                      # -> false
nix eval .#debug.config.systems                                          # -> [ "x86_64-linux" ]
```

Remove `debug = true` afterwards — it adds non-standard flake outputs.

**Step 5 — prove the fix.** Re-run the step 1 command and show the non-empty result
before reporting success:

```bash
nix eval .#packages.x86_64-linux --apply builtins.attrNames
# [ "my-feature-pkg" ]
```

Mechanism: `flake-parts-semantics.md §2`.

---

## 2. `error: attribute 'pkgs' missing`

```
… while evaluating the module argument `pkgs' in "/nix/store/…-source/modules/probe.nix":
… noting that argument `pkgs` is not externally provided, so querying `_module.args` instead, requiring `config`
error: attribute 'pkgs' missing
```

`pkgs` is a `perSystem` module argument only. Requesting it in a top-level flake-parts
module gets no dedicated message, because flake-parts never declares it there — the
module system falls back to `config._module.args.pkgs` and finds nothing.

The usual shape is a derivation hoisted out of `perSystem`:

```nix
# Wrong: pkgs is not in scope at the top level of a flake-parts module.
{ pkgs, ... }:
let app = pkgs.stdenv.mkDerivation { /* … */ };
in { perSystem = { ... }: { packages.app = app; }; }

# Right: build inside perSystem, where pkgs exists.
_: {
  perSystem = { pkgs, ... }: {
    packages.app = pkgs.stdenv.mkDerivation { /* … */ };
  };
}
```

When a non-system-scoped `flake.*` output needs a package, reach in with `withSystem`
rather than pulling `pkgs` outward — see `flake-parts-semantics.md §5`.

**This error is lazy.** `--apply builtins.attrNames` lists attribute names without
forcing their values, so a module with a bad `pkgs` reference still appears to work
there. Force the value to surface it:

```bash
nix eval .#packages.x86_64-linux.app.outPath    # or: nix build .#app
```

---

## 3. `self` or `inputs` is not a `perSystem` module argument

```
error: `self` (without `'`) is not a `perSystem` module argument, but a
module argument of the top level config.

The following is an example usage of `self`. Note that its binding
is in the `top` parameter list, which is declared by the top level module
rather than the `perSystem` module.

  top@{ config, lib, self, ... }: {
    perSystem = { config, self', ... }: {
      # in scope here:
      #  - self
      #  - self'
      #  - config (of perSystem)
      #  - top.config (note the `top@` pattern)
    };
  }
```

The same error text appears for `inputs`. Inside `perSystem`, use the primed forms:
`self'` is `self` narrowed to the current system, `inputs'` is `inputs` narrowed the
same way. To reach the unprimed values, bind them in the top-level parameter list with
the `top@{ … }` pattern shown in the message.

Also lazy — force the value to see it.

---

## 4. `error: The option `packages' does not exist`

```
error: The option `packages' does not exist. Definition values:
- In `/nix/store/…-source/modules/tlpkgs.nix':
    {
      x = 1;
    }

Did you mean `flake', `debug' or `perInput'?
```

A system-scoped output was defined at the top level of a flake-parts module. `packages`,
`devShells`, `apps`, `checks`, and `formatter` belong inside `perSystem`. Non-system-scoped
outputs — `nixosConfigurations`, `nixosModules`, `overlays`, `lib`, `templates` — belong
under `flake`.

This error is useful precisely because it is loud. If a misplaced definition produced no
error, the definition was inside `perSystem` after all, and the problem is section 1.

---

## 5. flake does not provide attribute `packages.<system>`

```
error: flake 'git+file:///home/you/project' does not provide attribute
'packages.x86_64-linux.packages.x86_64-linux',
'legacyPackages.x86_64-linux.packages.x86_64-linux' or 'packages.x86_64-linux'
```

The system is not in the `systems` list. Confirm with `nix eval .#packages --apply
builtins.attrNames` — an empty `[ ]` means `systems` is empty or was never defined.

Note the asymmetry: a missing `systems` makes `.#packages` return `[ ]` **silently**,
and only the per-system query errors. `nix flake show` shows nothing either way.

Under `import-tree`, `flake.nix` holds only inputs and the `mkFlake` call, so `systems`
must be defined in a module file. See `import-tree-and-dendritic.md`.

---

## 6. `cp: cannot stat …` — src layout

```
> unpacking source archive /nix/store/…-_src
> source root is _src
> Running phase: installPhase
> cp: cannot stat '_src/.': No such file or directory
```

`src = ./someDir` makes that directory the source root. Its *contents* are unpacked into
the build directory — there is no `someDir/` subdirectory to descend into. The build log
line `source root is _src` names the directory that was unpacked, not a path you can use.

```nix
# Wrong: assumes a _src/ subdirectory exists in the build dir.
src = ./_src;
installPhase = "mkdir -p $out && cp -r _src/. $out";

# Right: the files are already at the top of the build dir.
src = ./_src;
installPhase = "mkdir -p $out && cp -r . $out";
```

Confirm what the source root actually holds:

```bash
ls "$(nix eval --raw .#packages.x86_64-linux.site.src)"
# index.html      <- at the top level, not under _src/
```

---

## 7. A new file has no effect

Flakes enumerate the source tree with `git ls-files`. A file that is not tracked by git
is invisible to the evaluator during `nix build`, `nix develop`, and `nix flake check` —
**with no warning**:

```bash
$ nix eval .#packages.x86_64-linux --apply builtins.attrNames
[ "site" ]
$ git add -A
$ nix eval .#packages.x86_64-linux --apply builtins.attrNames
[ "site" "untracked" ]
```

`git add` the new file — committing is not required. The `warning: Git tree … is dirty`
message is expected for uncommitted-but-staged work and is not an error.

Under `import-tree`, also confirm the path contains no `/_` component: those are skipped
by design, equally silently.

---

## 8. `error: infinite recursion encountered`

Almost always an overlay referring to `final` where it must refer to `prev`. To override
a package in terms of itself, take the original from `prev`:

```nix
# Wrong: final.foo is the attribute being defined.
final: prev: { foo = final.foo.override { … }; }

# Right: prev.foo is the pre-overlay value.
final: prev: { foo = prev.foo.override { … }; }
```

Every *other* dependency in the overlay body should still reference `final`, so later
overlays compose. See `overlays-only-pattern.md §5`.

Add `--show-trace` to locate the attribute in the cycle.

---

## 9. `nix flake check` passes but `nix build` fails

`nix flake check` verifies the output schema and evaluates `checks`. It does not force
every derivation in `packages`, and Nix evaluation is lazy throughout — an attribute
name can exist while the expression behind it is broken. This is the same laziness that
hides sections 2 and 3. Build each package explicitly, or add a `checks` entry per
package so `nix flake check` covers it.

```bash
nix flake check --no-build     # schema and evaluation gate only
nix build .#default --dry-run  # forces the derivation without building it
nix build .#default            # the real check
```

---

## Escalation

```bash
nix repl
nix-repl> :lf .                 # load flake outputs into scope
nix-repl> packages.x86_64-linux
nix-repl> :b packages.x86_64-linux.default
```

Add `--show-trace` to any failing command for the full evaluation trace. For flake-parts
specifically, `debug = true` plus `allSystems` (section 1, step 4) is more direct than
reading a trace.
