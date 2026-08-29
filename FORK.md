# Maintenance fork

FM-Agent's maintenance fork of
[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph).

**Pinned base:** upstream `v1.6.0` (2026-08-26) — a tagged release, as the policy
below prefers. It carries fixes for the three issues reported upstream from this
project since the previous base: Rust field-receiver resolution
([#1585](https://github.com/colbymchenry/codegraph/issues/1585)), generic `impl`
ownership ([#1588](https://github.com/colbymchenry/codegraph/issues/1588)) and
Erlang per-arity identity
([#1610](https://github.com/colbymchenry/codegraph/issues/1610)). The previous
base was `c6aaa20` (upstream `main`, 2026-08-07), 27 commits behind this tag; see
issue #10 for the full rationale of this sync.

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

**Version marker:** `codegraph --version` → `1.6.0-fmagent.N` identifies a build
from this fork. Note this is a SemVer pre-release of `1.6.0`, so it sorts *below*
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
