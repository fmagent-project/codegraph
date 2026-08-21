# Maintenance fork

FM-Agent's maintenance fork of
[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph).

**Pinned base:** upstream `main` at `c6aaa20358cd6adcd04b87bdef8e5803ad146f3a`
(2026-08-07). That is *past* `v1.5.0` and before whatever upstream tags next:
`v1.5.0` was 104 commits behind, and the incremental-sync convergence work, the
first-class `union` nodes and the WAL growth fix in between all matter to how
FM-Agent reads the graph. The version marker keeps saying `1.5.0-fmagent.N`
because it is the last upstream *release* this descends from — the exact base is
this commit.

Upstream shipped the C macro-attribute extraction fix (issue #1211, PR #1311) in
v1.5.0, so the base carries it natively; the fork no longer needs its own patch
for it.

**Patches:** two, listed below. Apart from them the tree matches the pinned base, so
the fork stays cheap to re-sync. Every patch lives as a merged pull request here
and must be **re-applied on each upstream sync** — if a merge drops one, this list
is what catches it.

| File | Patch |
|------|-------|
| `src/resolution/name-matcher.ts` (+ `resolution/types.ts`, `resolution/index.ts`) | Bare-name refs elected among SEVERAL same-named METHODS by proximity are now labeled and optionally declined. Method dispatch is decided by the receiver's type, which a bare ref has lost — Rust extraction records every method call bare, so `(*uptr).assume_init_mut().queue.init()` resolved to the neighboring `ProcessManager::init` instead of `StaticLinkedList::init`, and FM-Agent's verification pipeline reasoned about the wrong function. Default behavior is unchanged (the election is what makes a monorepo's per-app same-named services resolve per app, #764) but the edge metadata now carries `methodCandidates: K`, so a type-aware consumer knows the edge was a guess among K and can re-check it. `CODEGRAPH_STRICT_METHOD_RESOLUTION=1` declines these elections instead (the ref stays unresolved) for consumers that derive facts from `calls` edges and re-add what their own typing can prove — FM-Agent indexes with it set. Unique names and receiver-bearing refs are unaffected in both modes. Test: `__tests__/bare-name-method-ambiguity.test.ts`. |
| `src/extraction/index.ts` | `fm_agent` added to `DEFAULT_IGNORE_DIRS`. FM-Agent writes its work directory into the project it analyses, holding one copy of every function it extracts plus the scripts staged to produce them, so indexing it lists each function twice and mixes tool code in with project code. Upstream deliberately keeps names that could be real source out of that list, so this stays fork-only; a project that does own an `fm_agent/` directory opts back in with a `.gitignore` negation (`!fm_agent/`). |

**Version marker:** `codegraph --version` → `1.5.0-fmagent.N` identifies a build
from this fork. Note this is a SemVer pre-release of `1.5.0`, so it sorts *below*
plain `1.5.0`; the updater must therefore point at this fork (see below), never
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
