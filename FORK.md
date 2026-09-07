# Maintenance fork

FM-Agent's maintenance fork of
[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph).

**Pinned base:** upstream `b9ca4b7` (`main`, 2026-08-31) — an untagged commit, the
exception the policy below allows. Upstream has not tagged since `v1.6.0`, and this
sync is not driven by a fix we need: it moves the fork onto upstream's unreleased
work so those features are available to us later, and so the next sync is a short
hop rather than another long one.

Nothing upstream has vetted this point, so the verification is ours. Those 60
commits are almost entirely the new `codegraph ui` browser viewer and the
Steps/Screens route visualisations; no engine change reaches the languages
FM-Agent indexes. That was measured, not assumed — every `calls` edge compared
by call-site position (file, line, column), since a rename would make a
name-keyed comparison lie:

| Corpus | Language | Call sites | Resolved differently |
|--------|----------|-----------:|---------------------:|
| redis | C | 48,806 | 0 |
| leveldb | C++ | 5,661 | 0 |
| FM-Agent | Python | 1,059 | 0 |
| this repo | Rust | 3,574 | 0 |
| this repo | TypeScript | 23,784 | 0 |
| this repo | JavaScript | 1,158 | 0 |
| this repo | Svelte | 518 | **13** |

The thirteen are the whole of the drift, and they are a fix: `toast.show()` used
to resolve to the receiver `toast` and now resolves to the method `show`
(upstream's object-literal namespace-member resolution). They sit in upstream's
own `.svelte` sources, a file type FM-Agent does not index. The Svelte row is
also what makes the zero rows worth trusting — it shows the comparison detects
change when there is change to detect.

The previous base was `v1.6.0` (2026-08-26), 60 commits behind this point; it
carried fixes for three issues reported upstream from this project — Rust
field-receiver resolution
([#1585](https://github.com/colbymchenry/codegraph/issues/1585)), generic `impl`
ownership ([#1588](https://github.com/colbymchenry/codegraph/issues/1588)) and
Erlang per-arity identity
([#1610](https://github.com/colbymchenry/codegraph/issues/1610)).

Upstream shipped the C macro-attribute extraction fix (issue #1211, PR #1311) in
v1.5.0, so the base carries it natively; the fork no longer needs its own patch
for it.

**Patches:** two, listed below. Apart from them the tree matches the pinned base,
so the fork stays cheap to re-sync. Every patch lives as a merged pull request here
and must be **re-applied on each upstream sync** — if a merge drops one, this list
is what catches it.

| File | Patch |
|------|-------|
| `src/extraction/index.ts` | `fm_agent` added to `DEFAULT_IGNORE_DIRS`. FM-Agent writes its work directory into the project it analyses, holding one copy of every function it extracts plus the scripts staged to produce them, so indexing it lists each function twice and mixes tool code in with project code. Upstream deliberately keeps names that could be real source out of that list, so this stays fork-only; a project that does own an `fm_agent/` directory opts back in with a `.gitignore` negation (`!fm_agent/`). |
| `__tests__/fm-agent-workdir-exclusion.test.ts` | Regression cover for the patch above, so a sync that drops or widens it fails `npm test` instead of shipping. Pins four things: the exclusion applies at the root and at any depth; it is a whole-name match, so `fm_agent_data/` and `my_fm_agent/` stay indexed; a `.gitignore` negation takes the directory back; and none of it depends on git. |

A sync brings new upstream test files in on its own — they are separate files, so
git takes them without asking. The case to watch for is upstream *moving* the test
tree or changing how the runner discovers it: our file would stay where it is, quietly
stop being collected, and nothing would fail. Check the suite's file count after a
sync, not just that it is green.

This base is the first time that actually happened: upstream renamed
`vitest.config.ts` to `vitest.config.mts` and split the suite into two projects with
a new `vitest.workspace.mts` (an `engine` project and a `ui` one, so the Svelte
component test can have jsdom and browser resolution conditions without handing them
to the engine suites). The `engine` project includes `__tests__/**/*.test.ts`, so our
file is still collected — confirmed by running it, not by reading the config. Run
`npx vitest run --project engine __tests__/fm-agent-workdir-exclusion.test.ts` after
a sync and check it reports 4 passing tests.

**Version marker:** `codegraph --version` → `1.6.0-fmagent.N` identifies a build
from this fork. It lives in **two** files as of this base: the root `package.json`
and `ui/package.json`. Upstream's `ui-package.test.ts` asserts the two match, so
bumping only the root fails `npm test` — which is how a future sync will catch it.
(Upstream's own `package.json` still reads `1.6.0` at this base: the unreleased
work is not version-bumped yet, so the marker stays a `1.6.0` pre-release.)

Note this is a SemVer pre-release of `1.6.0`, so it sorts *below* plain `1.6.0`;
the updater must therefore point at this fork (see below), never upstream, or it
would advertise a "downgrade to upstream" as an upgrade.

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
