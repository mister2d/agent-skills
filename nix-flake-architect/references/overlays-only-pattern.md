# Overlays-Only Flake Pattern

> Sources: Nix Reference Manual (https://nixos.org/manual/nix/stable/command-ref/new-cli/nix3-flake.html),
> flake.parts (https://flake.parts), nix.dev (https://nix.dev/concepts/flakes)
> Production references: oxalica/rust-overlay, nix-community/emacs-overlay,
> nix-community/nixpkgs-wayland, nixpkgs-firefox-addons

---

## Table of Contents

1. [When to Use This Pattern](#1-when-to-use-this-pattern)
2. [What an Overlays-Only Flake Exposes](#2-what-an-overlays-only-flake-exposes)
3. [CLI Impact Matrix — What Breaks and Why](#3-cli-impact-matrix--what-breaks-and-why)
4. [Mitigations: Restoring Useful CLI Surface](#4-mitigations-restoring-useful-cli-surface)
5. [Fixed-Point Composition Law](#5-fixed-point-composition-law)
6. [Nested Attrset Merge Anti-Pattern](#6-nested-attrset-merge-anti-pattern)
7. [Scoped vs Global Instantiation](#7-scoped-vs-global-instantiation)
8. [Module System Constraints](#8-module-system-constraints)
9. [flake-compat Shims](#9-flake-compat-shims)
10. [Overlay Testing via checks](#10-overlay-testing-via-checks)
11. [flake-parts Integration](#11-flake-parts-integration)
12. [Git Staging Rule](#12-git-staging-rule)

---

## 1. When to Use This Pattern

An overlays-only flake is appropriate when the primary deliverable is **a set of nixpkgs
modifications** consumed by downstream flakes as an input, not built directly by users.

**Correct use cases:**
- Custom package collection extending nixpkgs (e.g., packages not yet in nixpkgs)
- Organization-internal package registry distributed as a nixpkgs overlay
- Patching upstream packages to fix bugs or add features without forking nixpkgs
- Language ecosystem package sets (Python, Haskell, Rust toolchains)
- Hardware driver or firmware overlays

**Incorrect use cases — use a canonical flake instead:**
- A project that users `nix build`, `nix run`, or `nix develop` directly
- A NixOS system configuration repository
- A tool or application being distributed for end-user installation
- A devShell for a software project

The distinction: an overlays-only flake is a *library input*; a canonical flake is a
*runnable artifact*. Mixing both in one flake is valid (see composite pattern) but the
overlays-only mode is the cost-optimized distribution form for the library case.

---

## 2. What an Overlays-Only Flake Exposes

Canonical outputs for a pure distribution flake:

```
flake outputs:
├── overlays
│   └── default    ← primary deliverable (a function: final: prev: { ... })
├── nixosModules   ← optional; if shipping NixOS module alongside the overlay
│   └── default
└── lib            ← optional; pure helper functions (no derivation evaluation)
```

The `packages.<system>.*` tree is intentionally absent. This avoids the "Package Shape Tax":
evaluating thousands of derivations for every architecture at `nix flake show` and
`nix flake check` time, even when a consumer requires only one package from one system.

The `overlays.default` value is a function with signature `final: prev: { ... }`. It is not
a derivation and is not system-scoped. Any consumer can apply it to their own nixpkgs instance.

---

## 3. CLI Impact Matrix — What Breaks and Why

This is the table the agent MUST present to users when selecting the overlays-only mode.
The tradeoffs are real and must be understood before adoption.

| CLI Command | Status | Root Cause |
|---|---|---|
| `nix build` | **Broken** | No `packages.<system>.*` output |
| `nix run` | **Broken** | No `apps.<system>.*` or `packages.<system>.default` |
| `nix develop` | **Broken** (for consumers) | No `devShells.<system>.*` |
| `nix profile install .#<name>` | **Broken** | No `packages.*` output |
| `nix flake show` | Degraded | Shows only `overlays`, `nixosModules`, `lib` |
| `nix flake check` | Trivially passes | No `checks.*` → validates schema only, not content |
| `nix fmt` | **Broken** | No `formatter.<system>` |
| `nix search .` | **Broken** | No `packages.*` to search |

**These are not bugs — they are intentional trade-offs.** The commands above are designed
to operate on the flake's own built outputs. An overlays-only flake delegates those outputs
to its consumers. See Section 4 for mitigations.

**Note on `nix run` specifically:** If a user asks "how do I run package X from your overlay",
the correct answer is: apply the overlay in your flake, then `nix run .#X` from your flake,
not from the overlay flake. The overlay flake is never the entry point for execution.

---

## 4. Mitigations: Restoring Useful CLI Surface

These mitigations allow an overlays-only flake to remain useful to contributors and CI
without abandoning the distribution pattern.

### 4a. Smoke-Test Checks (restores `nix flake check`)

Add a `checks.<system>` output that instantiates the overlay against nixpkgs and builds
a representative subset of packages. This validates the overlay is correct without
publishing a full `packages.*` tree.

```nix
perSystem = { system, ... }: let
  pkgs = import inputs.nixpkgs {
    inherit system;
    overlays = [ self.overlays.default ];
  };
in {
  checks = {
    # Build representative packages to verify the overlay evaluates correctly.
    # Keep this list small — it is a smoke test, not a full matrix.
    smoke-my-tool    = pkgs.my-tool;
    smoke-my-lib     = pkgs.my-lib;

    # Optionally: verify the overlay doesn't break core nixpkgs packages it touches
    smoke-stdenv     = pkgs.stdenv;
  };
};
```

This gives `nix flake check` real work to do while avoiding full architecture enumeration.

### 4b. Internal devShell (restores `nix develop` for contributors)

This devShell is for people working *on* the overlay, not consumers:

```nix
perSystem = { pkgs, ... }: {
  devShells.default = pkgs.mkShell {
    packages = [
      pkgs.nixfmt-rfc-style   # format overlay code
      pkgs.nix-prefetch-git   # fetch package sources
      pkgs.cacert              # HTTPS in nix-prefetch operations
    ];
  };
};
```

This is not a consumer-facing API. Document it as internal in the README.

### 4c. Formatter (restores `nix fmt`)

```nix
perSystem = { pkgs, ... }: {
  formatter = pkgs.nixfmt-rfc-style;
};
```

### 4d. flake-compat Shims (backward compat — see Section 9)

### 4e. Exposing a Test Package for Ad-Hoc Builds

If you want to allow `nix build .#<package>` without fully publishing all packages,
add only the packages you intend to be directly testable:

```nix
perSystem = { system, ... }: let
  pkgs = import inputs.nixpkgs {
    inherit system;
    overlays = [ self.overlays.default ];
  };
in {
  # Explicit test/demo surface — not the primary distribution API
  packages.my-tool-test = pkgs.my-tool;
};
```

This is a hybrid: the overlay remains the primary distribution API, but a narrow
`packages.*` surface exists for direct testing. Document clearly which packages are
stable API vs. test-only.

---

## 5. Fixed-Point Composition Law

The overlay function signature is always `final: prev:`.

- `final` — the fully resolved, fixed-point nixpkgs after all overlays are applied
- `prev` — the nixpkgs state before this overlay (but after any overlays applied earlier)

**The Law:** Reference all *dependencies* from `final`. This ensures that if a downstream
overlay patches a library your package depends on, the patched version propagates into
your package automatically.

```nix
# CORRECT: depends on final — picks up downstream library patches
overlays.default = final: prev: {
  my-app = final.callPackage ./pkgs/my-app {
    inherit (final) libfoo;   # ← from final
  };
};

# WRONG: depends on prev — downstream libfoo patches do NOT reach my-app
overlays.default = final: prev: {
  my-app = final.callPackage ./pkgs/my-app {
    inherit (prev) libfoo;   # ← frozen at pre-overlay state
  };
};
```

**When to use `prev`:** Only to call the original version of the package you are overriding,
to avoid infinite recursion in the fixed-point:

```nix
overlays.default = final: prev: {
  openssl = prev.openssl.overrideAttrs (old: {
    # Use prev.openssl to get the original; using final.openssl would recurse infinitely
    patches = old.patches ++ [ ./fix-cve.patch ];
  });
};
```

---

## 6. Nested Attrset Merge Anti-Pattern

**Prohibited pattern:** Using `//` to merge a nested attribute set in nixpkgs:

```nix
# WRONG — shadows sibling attributes; breaks other overlays that touch python3Packages
overlays.default = final: prev: {
  python3Packages = prev.python3Packages // {
    my-lib = final.python3Packages.callPackage ./pkgs/my-lib {};
  };
};
```

The problem: `prev.python3Packages // { ... }` creates a new attribute set that captures
a fixed snapshot of `prev.python3Packages`. Any other overlay that also modifies
`python3Packages` is now operating on stale state, not the composed result.

**Correct pattern for Python packages:** Use `packageOverrides` through the Python overlay
mechanism, which properly threads the fixed-point through the package set:

```nix
# CORRECT — threads through the fixed-point correctly
overlays.default = final: prev: {
  python3 = prev.python3.override {
    packageOverrides = pyFinal: pyPrev: {
      my-lib = pyFinal.callPackage ./pkgs/my-lib {};
    };
  };
  # Also expose at top-level for convenience (optional):
  python3Packages = final.python3.pkgs;
};
```

**Same rule applies to other recursive package sets:** `perlPackages`, `rubyPackages`,
`haskellPackages`, `nodePackages`. Use the respective `.override { packageOverrides = ...; }`
mechanism, never `//` on the set directly.

**For top-level package additions** (not modifying recursive sets), `//` at the overlay
root is fine — that is the entire point of the overlay function:

```nix
overlays.default = final: prev: {
  # This is correct — adding new top-level attrs, not merging nested sets
  my-new-package = final.callPackage ./pkgs/my-new-package {};
  another-package = final.callPackage ./pkgs/another {};
};
```

---

## 7. Scoped vs Global Instantiation

When a consumer applies an overlay, they choose between two scopes.

### Global Modification (NixOS module option)

```nix
# In nixosConfiguration module:
nixpkgs.overlays = [ inputs.my-overlay.overlays.default ];
```

This modifies the *global* `pkgs` instance passed to every module in the system configuration.
Every package in every module now evaluates against the patched nixpkgs. Consequences:
- Any package touched by the overlay forces re-evaluation across the entire system
- Binary cache hits decrease: the overlaid nixpkgs has a different hash from the official one
- Appropriate when: the overlay patches something used system-wide (e.g., a core library)

### Scoped Instantiation (local nixpkgs import)

```nix
# In perSystem or a specific module:
let
  pkgs = import inputs.nixpkgs {
    inherit system;
    overlays = [ inputs.my-overlay.overlays.default ];
  };
in {
  packages.my-thing = pkgs.my-custom-package;
  # Only packages.my-thing evaluates against the overlaid nixpkgs
}
```

This creates a *local* nixpkgs instance with the overlay applied. Only derivations built
from this `pkgs` are affected. The system's global `pkgs` is unchanged.
Consequences:
- Binary cache integrity preserved for everything outside this scope
- Overlay affects only the packages that explicitly use this `pkgs`
- Appropriate when: the overlay provides specialized packages used in a narrow context

**Architectural guidance:** Prefer scoped instantiation. Use global only when the overlay
patches something that must be consistent across the entire system (e.g., replacing `glibc`,
patching `openssl` for security compliance). For organization-internal package additions,
scoped is always correct.

---

## 8. Module System Constraints

### `imports` vs `import` in Modules

Within a NixOS module (or flake-parts module), always use `imports` for composing other
modules. Never use bare `import` inside a module's attribute set.

```nix
# CORRECT: lazy, structured merge through the module system
{ ... }: {
  imports = [
    ./sub-module-a.nix
    ./sub-module-b.nix
  ];
}

# WRONG: eager evaluation, bypasses module system merge machinery
{ ... }: import ./sub-module-a.nix  # This returns an attrset, not a module
```

### `specialArgs.lib` — Do Not Override Standard Args

Injecting `lib` via `specialArgs` shadows the standard `lib` module argument. This breaks
the ability of any module to be used transparently as a submodule (the submodule evaluator
provides its own `lib`).

```nix
# WRONG: shadows standard lib, breaks submodule portability
nixpkgs.lib.nixosSystem {
  specialArgs = { lib = myCustomLib; };  # ← DO NOT DO THIS
  modules = [ ./config.nix ];
}

# CORRECT: extend lib inside the module via overlay or helper attr
nixpkgs.lib.nixosSystem {
  specialArgs = { myHelpers = import ./lib/helpers.nix { inherit (nixpkgs) lib; }; };
  modules = [ ./config.nix ];  # access via myHelpers, not lib
}

# ALSO CORRECT: expose lib helpers as a flake output, consume as input
flake = {
  lib = import ./lib { inherit (nixpkgs) lib; };
};
# Consumer: inputs.my-flake.lib.myHelper
```

---

## 9. flake-compat Shims

For environments where Flakes are not enabled (legacy CI, `nix-shell` users), add shims.

```bash
# Install flake-compat
# Verify current URL via nixos-tools: nix {"action":"search","source":"flakehub","query":"flake-compat"}
```

`default.nix`:
```nix
# Compatibility shim: allows `nix-build` to use the flake's default package
(import (
  fetchTarball {
    url = "https://github.com/edolstra/flake-compat/archive/master.tar.gz";
    # Pin this sha256: run nix-prefetch-url --unpack <url> to get current hash
    sha256 = "REPLACE_WITH_PINNED_SHA256";
  }
) { src = ./.; }).defaultNix
```

`shell.nix`:
```nix
# Compatibility shim: allows `nix-shell` to use the flake's devShell
(import (
  fetchTarball {
    url = "https://github.com/edolstra/flake-compat/archive/master.tar.gz";
    sha256 = "REPLACE_WITH_PINNED_SHA256";
  }
) { src = ./.; }).shellNix
```

For overlays-only flakes, the `defaultNix` result will be null or minimal since there is
no `packages.default`. Consider documenting this explicitly in the README so consumers
are not confused by a `nix-build` that produces no output.

---

## 10. Overlay Testing via `checks`

A well-tested overlays-only flake includes checks that validate overlay correctness.

```nix
# Full pattern: instantiate overlay, run test derivations
perSystem = { system, pkgs, ... }: let
  # Scoped nixpkgs with overlay applied — the exact environment consumers will use
  overlaidPkgs = import inputs.nixpkgs {
    inherit system;
    overlays = [ self.overlays.default ];
  };
in {
  checks = {
    # 1. Does the overlay evaluate without errors?
    overlay-eval = overlaidPkgs.my-package;

    # 2. Does the package install correctly?
    overlay-install = overlaidPkgs.runCommand "overlay-install-test" {
      nativeBuildInputs = [ overlaidPkgs.my-package ];
    } ''
      my-package --version > $out
    '';

    # 3. Does core nixpkgs still evaluate after overlay?
    # (detects broken recursive set merges — Section 6)
    nixpkgs-integrity = overlaidPkgs.hello;

    # 4. Does the nixosModule compose without conflicts?
    # (if nixosModules.default is exposed)
    # module-eval = (import "${inputs.nixpkgs}/nixos/lib/eval-config.nix" {
    #   inherit system;
    #   modules = [ self.nixosModules.default { ... } ];
    # }).config.system.build.toplevel;
  };
};
```

CI recommendation: run `nix flake check` on every PR. The `checks` above turn this from
a schema-only gate into a meaningful regression test.

---

## 11. flake-parts Integration

flake-parts provides `inputs'` and `self'` — system-specialized views of inputs.

```nix
# In perSystem context:
perSystem = { system, inputs', self', pkgs, ... }: {
  # inputs'.nixpkgs.legacyPackages is pkgs for the current system
  # self'.packages is self.packages.${system}

  checks.my-test = pkgs.runCommand "test" {
    # inputs' prevents accidentally using an x86_64-linux package on aarch64-linux
    buildInputs = [ inputs'.my-other-input.packages.some-tool ];
  } ''
    some-tool --test > $out
  '';
};
```

For overlays-only flakes, expose the overlay under `flake.overlays` (non-system-scoped),
not under `perSystem`:

```nix
flake-parts.lib.mkFlake { inherit inputs; } {
  systems = import inputs.systems;

  perSystem = { ... }: {
    # Internal tooling only (devShell, checks, formatter)
  };

  flake = {
    # The actual distribution API — not system-scoped
    overlays.default = final: prev: { ... };
    nixosModules.default = ./modules;
  };
}
```

`flakeModules` (flake-parts' typed output extension) can be used to distribute reusable
flake-parts modules alongside overlays:

```nix
flake = {
  overlays.default   = final: prev: { ... };
  flakeModules.default = ./flake-modules/my-feature.nix;  # for flake-parts consumers
};
```

Note: `flakeModules` is NOT a standard Nix CLI output. `nix build` and `nix flake check`
do not process it. It is consumed only by other flake-parts flakes via their `imports` list.

---

## 12. Git Staging Rule

**Critical constraint:** Nix flakes use `git ls-files` to enumerate the source tree.
Any file not tracked by git is invisible to the evaluator during `nix build`, `nix develop`,
and `nix flake check`.

```bash
# A new package file is NOT picked up by nix until staged:
git add pkgs/my-new-package/default.nix   # ← required before nix flake check

# Verify what's visible to nix:
git ls-files pkgs/
```

For overlay development workflows: add files to the git index (`git add`) immediately
after creating them, before attempting any `nix` command. Staging without committing
is sufficient for evaluation.

---

## 13. Validation

Mode 2 checks, additional to the Phase 6 checklist in `SKILL.md`.

- [ ] **CLI trade-offs disclosed:** the user has seen the CLI Impact Matrix (§3) before
  the adoption decision was made
- [ ] `overlays.default` is a function `final: prev: { ... }`, not a derivation
- [ ] `overlays.default` is in the `flake = { ... }` block, not under `perSystem`
- [ ] Dependencies within the overlay body reference `final`, not `prev` — except when
  calling the original `prev.<name>` to avoid infinite recursion in an override
- [ ] No `prev.attrSet // { ... }` nested merge on recursive package sets; use
  `prev.python3.override { packageOverrides = ...; }` instead
- [ ] `specialArgs.lib` is not overridden; custom helpers go in `flake.lib` or
  `specialArgs.<customName>`
- [ ] `checks.<system>.*` includes at least one smoke test that instantiates the overlay,
  so `nix flake check` catches real regressions rather than schema drift alone
- [ ] Smoke-test `pkgs` uses scoped instantiation:
  `import nixpkgs { overlays = [ self.overlays.default ]; }`
- [ ] `devShells.default` present for overlay contributors — internal tooling, not consumer API
- [ ] `formatter.<system>` set so `nix fmt` works for contributors
- [ ] Any exposed `nixosModules.*` uses `imports`, never bare `import`, for sub-modules
- [ ] Any exposed `flakeModules.*` is documented as flake-parts-only, not a standard CLI output
- [ ] `flake-compat` shims (`default.nix`, `shell.nix`) added if legacy `nix-shell` support is required
- [ ] New package files staged with `git add` before any `nix flake check` (§12)
- [ ] Package attribute names checked against nixpkgs for collisions with existing
  top-level attrs: `nix {"action":"search","query":"<name>"}`
