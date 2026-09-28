# Maintenance fork

FM-Agent's maintenance fork of
[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph).

**Pinned base:** upstream `e63fe2e` (`main`, 2026-09-27) — an untagged commit, the
exception the policy below allows: upstream has not tagged since `v1.6.0`, and the
fixes this sync is for live only on `main`.

It carries this project's
[PR #1865](https://github.com/colbymchenry/codegraph/pull/1865) for Dart 3
extension types ([#1784](https://github.com/colbymchenry/codegraph/issues/1784)),
which was patch 5 here byte for byte, and fixes for three issues reported upstream
from this project: functions bound through a string-named wrapper
([#1747](https://github.com/colbymchenry/codegraph/issues/1747), upstream PR #2002),
C/C++ functions defined through a single-argument macro
([#1373](https://github.com/colbymchenry/codegraph/issues/1373), #2017), and Rust
`self.method()` owners ([#1861](https://github.com/colbymchenry/codegraph/issues/1861),
#1882).

The #1747 fix names a wrapped function after the binding its result lands in — a
declarator, or an object member's key. That binding is the identifier call sites
use, so the fork now defers to it, and patches 2 and 3 narrow to what it leaves:
wrappers nothing binds, and calls into a service's members. Measured on
`sst/opencode` (`df23b7f`) by source position, upstream alone reaches 1,017 of the
1,055 `Effect.fn*("…")(function…)` sites; with patch 2, all 1,055.

The previous base was `3ed73bc` (`main`, 2026-09-13), 93 commits behind this point
(91 of them not merges). It had brought upstream's fixes for TS/JS generator
functions ([#1741](https://github.com/colbymchenry/codegraph/issues/1741)) and C++
pure virtual methods ([#1727](https://github.com/colbymchenry/codegraph/issues/1727)).
Upstream's generator fix stops short in one place — the two helpers that read a
class field's value still do not list `generator_function`, on either extraction
path — so the part of the fork's patch covering that shape stays, as patch 4 below.

Upstream shipped the C macro-attribute extraction fix (issue #1211, PR #1311) in
v1.5.0, so the base carries it natively; the fork no longer needs its own patch
for it.

**Patches:** four, listed below, each one file of behaviour plus the regression
test that catches its loss. Apart from them the tree matches the pinned base, so
the fork stays cheap to re-sync. Every patch lives as a merged pull request here
and must be **re-applied on each upstream sync** — if a merge drops one, this list
is what catches it.

Patches 2 and 3 are a pair on top of upstream's #1747 naming: patch 2 names the
wrapped functions no binding names, and patch 3 resolves the calls into service
members that naming leaves unresolved. Each goes when upstream covers its half.

| File | Patch |
|------|-------|
| `src/extraction/index.ts` | `fm_agent` added to `DEFAULT_IGNORE_DIRS`. FM-Agent writes its work directory into the project it analyses, holding one copy of every function it extracts plus the scripts staged to produce them, so indexing it lists each function twice and mixes tool code in with project code. Upstream deliberately keeps names that could be real source out of that list, so this stays fork-only; a project that does own an `fm_agent/` directory opts back in with a `.gitignore` negation (`!fm_agent/`). |
| `__tests__/fm-agent-workdir-exclusion.test.ts` | Regression cover for the patch above, so a sync that drops or widens it fails `npm test` instead of shipping. Pins four things: the exclusion applies at the root and at any depth; it is a whole-name match, so `fm_agent_data/` and `my_fm_agent/` stay indexed; a `.gitignore` negation takes the directory back; and none of it depends on git. |
| `src/extraction/tree-sitter.ts`, `codegraph-kernel/src/tsjs/mod.rs`, `codegraph-kernel/src/tsjs/extractors.rs` | **Wrapper naming, where nothing binds the result.** `Effect.fn("Session.run")(function* () {…})` is anonymous only syntactically. Upstream (#1747) names it after the binding its result lands in — a declarator, or an object member's key — and this patch defers to that wherever one exists: `wrappedFunctionName` returns nothing when `curriedWrapperBoundName` names the function. It covers what is left: a wrapper passed as an argument to another call (`Runtime.handler(cmd, Effect.fn("cli.api")(…))`, `InstanceState.make(Effect.fn("Agent.state")(…))`), an array element, an arrow body, a return value. Nothing names the function there except the wrapper's string, so that becomes its name, and with `.` read as `::` its qualified name. Without it the function has no node, and the calls in its body attribute to whatever encloses it — 38 of the 1,055 wrapper sites on `sst/opencode`. Both extraction paths carry it — the native kernel runs by default. |
| `__tests__/fm-agent-wrapper-named-functions.test.ts` | Regression cover for the patch above, on one source holding every shape: a declarator and an object member keep upstream's binding name; the six unbound shapes are named after the wrapper string, qualified name included, with their body's call attributed to them; an ordinary `items.map((i) => …)` callback stays anonymous; and both extraction paths return identical nodes, edges and refs. |
| `src/resolution/name-matcher.ts` | **Effect-TS service member resolution.** Most calls in Effect code go to a service's members — `const state = yield* SessionRunState.Service; state.assertNotBusy()`, or `EventV2.readAggregate(…)` on an imported namespace. The receiver has no source-level type, and the member sits in an object a factory returns rather than as an export, so neither receiver inference nor import resolution reaches it. The namespace is written down in one place: the wrapper string on the member's own line, `Effect.fn("SessionRunState.assertNotBusy")`. So `matchMethodCall` takes the namespace from the receiver's own nearest declaration (one `Ns.create(…)` factory hop allowed), or from a capitalised receiver itself, and resolves to the unique member whose wrapper string is `Ns.method` — only when the calling file imports that namespace. On `sst/opencode` that is about 420 function-to-function call edges outside test code. The patch used to also bridge a bare `helper()` to a node named `Ns.helper`; under upstream's naming the binding already is the node's name, and the bridge only minted a false edge whenever a string's tail matched another name, so it is gone, along with the pre-filter escape in `src/resolution/index.ts` it needed. |
| `__tests__/fm-agent-effect-ts-resolution.test.ts` | Regression cover for the patch above: a member call on a `yield* Ns.Service` local and a direct call on an imported, self-re-exporting namespace, each picking the right one of two same-named members; the missing-import and shadow declines; the `Ns.Service.create` factory hop; and a bare call never reaching a wrapped function through its string's tail. |
| `src/extraction/languages/typescript.ts`, `src/extraction/languages/javascript.ts`, `codegraph-kernel/src/tsjs/mod.rs` | **Generator class fields.** A class field holding a generator — `class Repo { loadAll = function* () {…} }`, directly or through a wrapper call — is a method written as a field. Two helpers decide that, one classifying the field and one finding the body to walk, and each lists the node types a field's value may have. Without `generator_function` on those lists the field is a property: no callable node, and the calls in its body attribute to the file. The lists exist once per extraction path — the walker's in the language files, the kernel's in `classify_ts_class_member` and `resolve_field_body` — and have to move together: with one side updated the same source is a method on one extraction path and a property on the other. |
| `__tests__/fm-agent-generator-class-field.test.ts` | Regression cover for the patch above, in TypeScript and JavaScript: the field is a method under its class's qualified name, the wrapped form is too, its body's call is attributed to it rather than to the file, and both extraction paths return identical nodes, edges and refs for the same source. |

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
