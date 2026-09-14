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

The previous base was `v1.6.0` (2026-08-26), 60 commits behind this point; it
carried fixes for Rust field-receiver resolution
([#1585](https://github.com/colbymchenry/codegraph/issues/1585)), generic `impl`
ownership ([#1588](https://github.com/colbymchenry/codegraph/issues/1588)) and
Erlang per-arity identity
([#1610](https://github.com/colbymchenry/codegraph/issues/1610)).

Upstream shipped the C macro-attribute extraction fix (issue #1211, PR #1311) in
v1.5.0, so the base carries it natively; the fork no longer needs its own patch
for it.

**Patches:** three, listed below, each one file of behaviour plus the regression
test that catches its loss. Apart from them the tree matches the pinned base, so
the fork stays cheap to re-sync. Every patch lives as a merged pull request here
and must be **re-applied on each upstream sync** — if a merge drops one, this list
is what catches it.

Patches 2 and 3 are a pair, and both are temporary: patch 2 exists because
upstream has not merged the fix for
[#1747](https://github.com/colbymchenry/codegraph/issues/1747) yet
([PR #1814](https://github.com/colbymchenry/codegraph/pull/1814)), and patch 3
exists only to resolve the qualified names patch 2 mints. If upstream takes
#1814 *with* the literal-name preference, both can go. If it takes #1814 as it
stands — declarator names only — then patch 2 goes, patch 3 goes with it, and the
cost is a bare `helper` where a qualified `Session.helper` used to be.

| File | Patch |
|------|-------|
| `src/extraction/index.ts` | `fm_agent` added to `DEFAULT_IGNORE_DIRS`. FM-Agent writes its work directory into the project it analyses, holding one copy of every function it extracts plus the scripts staged to produce them, so indexing it lists each function twice and mixes tool code in with project code. Upstream deliberately keeps names that could be real source out of that list, so this stays fork-only; a project that does own an `fm_agent/` directory opts back in with a `.gitignore` negation (`!fm_agent/`). |
| `__tests__/fm-agent-workdir-exclusion.test.ts` | Regression cover for the patch above, so a sync that drops or widens it fails `npm test` instead of shipping. Pins four things: the exclusion applies at the root and at any depth; it is a whole-name match, so `fm_agent_data/` and `my_fm_agent/` stay indexed; a `.gitignore` negation takes the directory back; and none of it depends on git. |
| `src/extraction/tree-sitter.ts`, `codegraph-kernel/src/tsjs/mod.rs` | **Wrapper naming.** Upstream PR #1814 gives an anonymous function passed to a curried wrapper (`const run = Effect.fn("Session.run")(function* () {…})`) the name of the declarator that binds it; without a node at all its body's calls attribute to the file, so the file gains an outgoing edge that belongs to a function. On top of that PR this prefers a literal name the factory was handed, because that is the name the author qualified — `Effect.fn("Session.run")` says `run` OF `Session`, the declarator only says `run`, and two same-named handlers in different namespaces stay apart. A factory with no literal (`connect(mapState)`, a project's own HOC) falls back to the declarator, so #1814's wider coverage is kept; a substitution-free template literal counts, one that interpolates does not. Both extraction paths carry it — the native kernel is the one that runs by default. |
| `__tests__/curried-wrapper-handlers.test.ts` | Regression cover for the patch above (#1814's own file, extended). Pins the literal winning over the declarator, the three fall-back shapes (no literal, a variable, an interpolating template), and the bound that keeps this narrow: `useMemo(() => …, [])` and `arr.map(() => …)` are single calls whose argument is a computation and must stay anonymous. |
| `src/resolution/name-matcher.ts`, `src/resolution/index.ts` | **Effect-TS resolution.** The names patch 2 mints are qualified (`Session.helper`) while call sites are bare (`helper()`), so the edge landed on the same-named constant rather than the function — the call relation between two functions was lost. Two uniqueness/scope/import-gated matchers close that, plus a pre-filter escape in `index.ts` so a tail-named ref survives the symbol-existence check long enough to reach them. The candidate test keys on a dot in the **name** (`Ns.helper`), which is the extractor's mark for a wrapper-named node. It must not also accept a qualified-name suffix: `Record::serialize` ends with `::serialize` for every ordinary method, so that made every same-named method a candidate and let this answer before upstream's rule that a receiver-less JS/TS call never binds to a method (#1714). |
| `__tests__/effect-ts-resolution.test.ts` | Regression cover for the patch above: bare call to a wrapper-named local, a same-file target beating a cross-file bare name, ambiguity and sibling-scope declines, `yield* Ns.Service` member resolution, the shadow decline, the `Ns.Service.create` factory hop, and the plain variable-declarator path staying untouched. |

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
