# Maintenance fork

FM-Agent's maintenance fork of
[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph).

**Pinned base:** upstream `v1.3.0` (this fork's `main` is reset to that tag).

**Patches:** each fix we needed that upstream hadn't shipped lives in a merged
pull request. For the current patch set, see this repository's **Pull Requests**
(merged) and the notes on each **Release** — that list is the source of truth, so
this file never has to enumerate individual patches.

**Version marker:** `codegraph --version` → `1.3.0-fmagent.N` identifies a build
from this fork.

**Releases:** tagged `vX.Y.Z-fmagent.N`, each carrying self-contained per-OS
bundles (darwin/linux, arm64/x64). FM-Agent's `install.sh` pins one via
`CODEGRAPH_VERSION`.

**Policy:** pin to a base, don't chase upstream. Upstream is tracked via the
`upstream` git remote (not a local branch). Retire once upstream ships the fixes
in a release.
