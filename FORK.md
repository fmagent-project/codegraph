# Maintenance fork

FM-Agent's maintenance fork of
[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph).

**Pinned base:** upstream `3ed73bc` (`main`, 2026-09-13) — an untagged commit, the
exception the policy below allows: upstream has not tagged since `v1.6.0`, and two
fixes this fork had been carrying its own versions of live only on `main`.

It carries fixes for two more issues reported upstream from this project —
TS/JS generator functions
([#1741](https://github.com/colbymchenry/codegraph/issues/1741)) and C++ pure
virtual methods
([#1727](https://github.com/colbymchenry/codegraph/issues/1727)) — plus a chained
call no longer collapsing to a bare method name (upstream's own #1759). Both of
the first two replace fork patches, and both upstream versions are wider: the
fork's generator patch reached only the expression form, and its chained-call
patch removed the false edge by refusing to match at all, which also killed
legitimate ones.

Upstream's generator fix stops short in one place — the two helpers that read a
class field's value still do not list `generator_function` — so the part of the
fork's patch covering that shape stays, as patch 4 below.

The previous base was `v1.6.0` (2026-08-26), 120 commits behind this point (115
of them not merges); it carried fixes for Rust field-receiver resolution
([#1585](https://github.com/colbymchenry/codegraph/issues/1585)), generic `impl`
ownership ([#1588](https://github.com/colbymchenry/codegraph/issues/1588)) and
Erlang per-arity identity
([#1610](https://github.com/colbymchenry/codegraph/issues/1610)).

Upstream shipped the C macro-attribute extraction fix (issue #1211, PR #1311) in
v1.5.0, so the base carries it natively; the fork no longer needs its own patch
for it.

**Patches:** five, listed below, each one file of behaviour plus the regression
test that catches its loss. Apart from them the tree matches the pinned base, so
the fork stays cheap to re-sync. Every patch lives as a merged pull request here
and must be **re-applied on each upstream sync** — if a merge drops one, this list
is what catches it.

Patches 2 and 3 are a pair: patch 2 names a function a string-named wrapper
wraps, and patch 3 resolves the qualified names patch 2 mints. Both go when
upstream ships an equivalent for
[#1747](https://github.com/colbymchenry/codegraph/issues/1747).

[PR #1814](https://github.com/colbymchenry/codegraph/pull/1814) there is not
that equivalent. It names such a function after the declarator that binds it,
which requires the wrapper's result to land in a binding the walk recognises;
an Effect service is usually an object *returned from inside a function*, and
its members are never reached. Measured on `sst/opencode`: 825 of 1,056
string-named wrappers, against 1,055 for the approach below, which asks whether
a wrapper encloses the function wherever an anonymous function is walked and so
has no structural precondition.

| File | Patch |
|------|-------|
| `src/extraction/index.ts` | `fm_agent` added to `DEFAULT_IGNORE_DIRS`. FM-Agent writes its work directory into the project it analyses, holding one copy of every function it extracts plus the scripts staged to produce them, so indexing it lists each function twice and mixes tool code in with project code. Upstream deliberately keeps names that could be real source out of that list, so this stays fork-only; a project that does own an `fm_agent/` directory opts back in with a `.gitignore` negation (`!fm_agent/`). |
| `__tests__/fm-agent-workdir-exclusion.test.ts` | Regression cover for the patch above, so a sync that drops or widens it fails `npm test` instead of shipping. Pins four things: the exclusion applies at the root and at any depth; it is a whole-name match, so `fm_agent_data/` and `my_fm_agent/` stay indexed; a `.gitignore` negation takes the directory back; and none of it depends on git. |
| `src/extraction/tree-sitter.ts`, `codegraph-kernel/src/tsjs/mod.rs`, `codegraph-kernel/src/tsjs/extractors.rs` | **Wrapper naming.** `Effect.fn("Session.run")(function* () {…})` is anonymous only syntactically: the name is the wrapper's first argument, and it is the one a trace or a log shows. Without a node the function is absent from the graph — its callers have nothing to point at, and its body's calls attribute to whatever encloses it, so a file or an outer function gains an outgoing edge that belongs to it. The test asks, wherever an anonymous function is walked, whether a `fn` / `fnUntraced` wrapper with a string-literal first argument encloses it; having no structural precondition is what lets it reach a service object returned from inside a function, the common Effect shape. The wrapper string becomes the qualified name (`Session::run`), since it already carries the qualification the author wrote. Both extraction paths carry it — the native kernel runs by default. |
| `__tests__/fm-agent-wrapper-named-functions.test.ts` | Regression cover for the patch above. Pins a wrapped generator and a wrapped arrow, each with its qualified name and its body's call attributed to it rather than to the file; the service-object-returned-from-a-function shape, which is what distinguishes this from a declarator-bound approach; and an ordinary `items.map((i) => …)` callback staying anonymous, so the graph gains no node for it. |
| `src/resolution/name-matcher.ts`, `src/resolution/index.ts` | **Effect-TS resolution.** The names patch 2 mints are qualified (`Session.helper`) while call sites are bare (`helper()`), so the edge landed on the same-named constant rather than the function — the call relation between two functions was lost. Two uniqueness/scope/import-gated matchers close that, plus a pre-filter escape in `index.ts` so a tail-named ref survives the symbol-existence check long enough to reach them. The candidate test keys on a dot in the **name** (`Ns.helper`), which is the extractor's mark for a wrapper-named node. It must not also accept a qualified-name suffix: `Record::serialize` ends with `::serialize` for every ordinary method, so that made every same-named method a candidate and let this answer before upstream's rule that a receiver-less JS/TS call never binds to a method (#1714). |
| `__tests__/fm-agent-effect-ts-resolution.test.ts` | Regression cover for the patch above: bare call to a wrapper-named local, a same-file target beating a cross-file bare name, ambiguity and sibling-scope declines, `yield* Ns.Service` member resolution, the shadow decline, the `Ns.Service.create` factory hop, and the plain variable-declarator path staying untouched. |
| `src/extraction/languages/typescript.ts`, `src/extraction/languages/javascript.ts` | **Generator class fields.** A class field holding a generator — `class Repo { loadAll = function* () {…} }`, directly or through a wrapper call — is a method written as a field. Two helpers decide that, one classifying the field and one finding the body to walk, and each lists the node types a field's value may have. Without `generator_function` on those lists the field is a property: no callable node, and the calls in its body attribute to the file. The native kernel already lists it (`codegraph-kernel/src/tsjs/mod.rs`), so this is the walker half of a pair that has to move together — with one side updated the same source is a method on one extraction path and a property on the other. |
| `__tests__/fm-agent-generator-class-field.test.ts` | Regression cover for the patch above, in TypeScript and JavaScript: the field is a method under its class's qualified name, the wrapped form is too, its body's call is attributed to it rather than to the file, and both extraction paths return identical nodes, edges and refs for the same source. |
| `src/extraction/languages/dart.ts`, `codegraph-kernel/src/dart.rs` | **Dart extension types.** Dart 3.3's `extension_type_declaration` was listed among neither path's class types, though the older `extension_declaration` was — three lists in all, one in the walker and two in the kernel. Each path was then wrong in its own way: the walker never entered the body, so a `double get km => …` got no node and the member after it had its span cut short at the signature line; the kernel reached the members through a fallback but minted them as top-level functions, with no type node for them to belong to. Listing the node type in all three is the whole fix. **Temporary** — the same change is [upstream PR #1865](https://github.com/colbymchenry/codegraph/pull/1865) for [#1784](https://github.com/colbymchenry/codegraph/issues/1784); drop this patch once that merges and the base moves past it. Until then it is also what keeps `kernel-dart-parity` green here: upstream `main` fails four of its cases, built and run on its own to confirm, and upstream has no CI workflow, so this fork's `ci.yml` is where that gate actually runs. |
| `__tests__/fm-agent-dart-extension-type.test.ts` | Regression cover for the patch above: an extension type is a type node of its own with its members as methods under it; the member after a getter keeps its full span; and an ordinary class is unchanged. Goes with the patch when upstream's lands. |

A sync brings new upstream test files in on its own — they are separate files, so
git takes them without asking. The case to watch for is upstream *moving* the test
tree or changing how the runner discovers it: our file would stay where it is, quietly
stop being collected, and nothing would fail. Check the suite's file count after a
sync, not just that it is green.

**Version marker:** `codegraph --version` → `1.6.0-fmagent.N` identifies a build
from this fork. It lives in **two** files as of this base — the root `package.json`
and `ui/package.json` — and `__tests__/ui-package.test.ts` asserts the two match.
Upstream ships `scripts/sync-ui-version.mjs` for this, but it runs only from
`build:lib`; neither `npm test` nor `npm run build` reaches it, so a version bump
has to touch both files by hand or the suite goes red.

Note this is a SemVer pre-release of `1.6.0`, so it sorts *below*
plain `1.6.0`; the updater must therefore point at this fork (see below), never
upstream, or it would advertise a "downgrade to upstream" as an upgrade.

**All install/upgrade entry points point at this fork,** so a fork install never
silently escapes back to upstream: `install.sh` / `install.ps1` (`REPO` / `$repo`)
and the built-in updater (`src/upgrade/index.ts` `REPO`) all resolve releases and
installers from `fmagent-project/codegraph`.

**Releases:** tagged `vX.Y.Z-fmagent.N`, each carrying self-contained per-OS
bundles (darwin/linux/windows, arm64/x64) with the native Rust extraction
kernel. FM-Agent's `install.sh` pins one via `CODEGRAPH_VERSION`.

**Policy:** pin to a base, don't chase upstream — update only when we need
something a newer upstream state carries. Prefer a tagged release; an untagged
`main` commit is fair game when what we need is not released yet, and then the
commit id *is* the base (record it above, and verify the build ourselves —
nothing upstream has vetted it). Base updates land via a pull request that
**merges** that upstream point into `main` (so upstream stays an ancestor — blame,
audits and future syncs follow upstream history) and re-applies this fork layer;
merge such PRs with a merge commit, not a squash. Upstream is tracked via the
`upstream` git remote.
