# Maintenance fork

FM-Agent's maintenance fork of
[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph).

**Pinned base:** upstream `v1.5.0`. Upstream shipped the C macro-attribute
extraction fix (issue #1211, PR #1311) in v1.5.0, so this base carries it
natively — the fork no longer needs its own patch on top.

**Patches:** none currently — this base is byte-identical to upstream v1.5.0. The
fork is kept as standing infrastructure so an urgent fix upstream hasn't shipped
can be applied and released quickly if needed; each such fix would live as a
merged pull request here.

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
something a newer upstream release carries. Base updates land via a pull request
that **merges** the target upstream tag into `main` (so upstream stays an ancestor
— blame, audits and future syncs follow upstream history) and re-applies this
fork layer; merge such PRs with a merge commit, not a squash. Upstream is tracked
via the `upstream` git remote.
