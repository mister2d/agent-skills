# import-tree and the Dendritic Layout

`import-tree` turns a directory of `.nix` files into a flake-parts module list, so a
flake grows by adding files rather than by editing an `imports` list. This file covers
its interaction with flake-parts: where options must live, which paths get skipped, and
how both turn into empty outputs.

> Source: https://github.com/vic/import-tree. Behavior verified against `4ebb10ae`
> (2026-07-17) with flake-parts `427bf4bd`.

## Table of Contents

1. [What import-tree does](#1-what-import-tree-does)
2. [Where systems must live](#2-where-systems-must-live)
3. [The underscore skip rule](#3-the-underscore-skip-rule)
4. [Every file is an independent contributor](#4-every-file-is-an-independent-contributor)
5. [Debugging a dendritic flake](#5-debugging-a-dendritic-flake)
6. [Handoff to nixos-den-architect](#6-handoff-to-nixos-den-architect)

---

## 1. What import-tree does

`inputs.import-tree ./modules` recursively collects every `.nix` file under `./modules`
and returns them as a flake-parts module. The canonical call form passes that result
directly as `mkFlake`'s module argument:

```nix
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  inputs.flake-parts.url = "github:hercules-ci/flake-parts";
  inputs.import-tree.url = "github:vic/import-tree";

  outputs = inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; }
      (inputs.import-tree ./modules);
}
```

Each collected file is an ordinary flake-parts module — same argument scoping, same
merge semantics, same silent-empty failure modes as `flake-parts-semantics.md`
describes. import-tree changes only how modules are discovered.

---

## 2. Where systems must live

In the call form above, `mkFlake`'s second argument *is* the import-tree result. There
is no attrset in `flake.nix` to hold `systems`, `perSystem`, or anything else. **Every
option, including `systems`, must be defined in a module file under the scanned tree.**

```nix
# modules/systems.nix
_: {
  systems = [ "x86_64-linux" "aarch64-linux" ];
}
```

This is a consequence of the call form, not a rule import-tree enforces. Writing
`mkFlake { inherit inputs; } { systems = [ … ]; imports = [ (inputs.import-tree ./modules) ]; }`
keeps `systems` in `flake.nix` and works fine — but the one-argument form above is the
idiom, and mixing the two is the usual source of confusion.

A missing `systems` fails quietly on one path and loudly on the other:

```bash
$ nix flake show
git+file:///home/you/project          # nothing else — no packages node

$ nix eval .#packages --apply builtins.attrNames
[ ]                                    # silent, exit 0

$ nix eval .#packages.x86_64-linux --apply builtins.attrNames
error: flake 'git+file:///home/you/project' does not provide attribute
'packages.x86_64-linux.packages.x86_64-linux',
'legacyPackages.x86_64-linux.packages.x86_64-linux' or 'packages.x86_64-linux'
```

Keep `systems` in its own file at the root of the tree. It is the one option whose
absence disables every other module's system-scoped output.

---

## 3. The underscore skip rule

import-tree ignores any path containing a `/_` component — both files and directories.
The rule is deliberate: it is how you park a module without deleting it, and how you
store non-module assets inside the scanned tree.

```
modules/
  systems.nix          loaded
  site.nix             loaded
  _wip.nix             skipped
  _legacy/             skipped entirely, including every file beneath it
  _src/index.html      not a .nix file, and skipped regardless — safe to keep here
```

Renaming a module to disable it is a supported workflow, and it is silent by design:

```bash
$ mv modules/site.nix modules/_site.nix
$ nix eval .#packages.x86_64-linux --apply builtins.attrNames
[ ]
```

That silence is indistinguishable from the guarded-`perSystem` failure. When outputs
go missing, check the filenames before checking the module bodies.

The convention pairs well with derivation sources: an assets directory named `_src`
lives inside `modules/` without being scanned, and `src = ./_src` still addresses it
normally. Note that its files then land at the **top** of the unpacked build directory,
not under `_src/` — see `troubleshooting.md §6`.

---

## 4. Every file is an independent contributor

Because each file is its own module, adding a file is the only step needed to add an
output — and forgetting to make a file contribute is the only step needed to lose one.
Three consequences worth stating explicitly:

- **No file is privileged.** `default.nix` has no special meaning to import-tree;
  it is scanned like any other `.nix` file.
- **`perSystem` definitions merge across files.** Ten files may each define
  `perSystem.packages.*`; they combine rather than conflict. Nothing warns when one of
  them contributes nothing.
- **Files are only visible to nix if git tracks them.** A newly created module is
  invisible until `git add`. Combined with the skip rule, a module can be absent for
  three unrelated reasons, none of which produce output. See `troubleshooting.md §7`.

---

## 5. Debugging a dendritic flake

Add `debug = true;` in any module under the tree, then read the merged result rather
than guessing which of many files failed to contribute:

```bash
nix eval .#debug.config.systems                                          # did systems.nix load?
nix eval .#allSystems.x86_64-linux.packages --apply builtins.attrNames   # merged perSystem outputs
```

To confirm which files import-tree actually collected, list the tree the way it does
and compare against what you expect:

```bash
find modules -name '*.nix' -not -path '*/_*'
git ls-files modules                       # what nix can actually see
```

A file present in the first list but absent from the second is untracked; a file absent
from both has an `_` in its path.

---

## 6. Handoff to nixos-den-architect

This file covers `import-tree` as it interacts with flake-parts — module discovery,
where `systems` has to live, and how a skipped or untracked path becomes an empty
output. A full repository migration to the dendritic pattern — aspect modules, `den`
conventions, per-class trees under `_nixos/`, `_darwin/`, `_homeManager/`, and the
staged conversion of an existing NixOS configuration — is the `nixos-den-architect`
skill's subject.

Hand off when the request is "convert my NixOS repo to dendritic". Stay here when it is
"my import-tree flake produces nothing". A dendritic repository is still a flake-parts
flake, so `flake-parts-semantics.md` and `troubleshooting.md` apply to it unchanged.
