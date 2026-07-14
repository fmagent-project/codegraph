# Maintenance fork

This is FM-Agent's maintenance fork of
[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph).

**Pinned base:** upstream `v1.3.0` (this fork's `main` is reset to that tag).

**Patch on top:**
- **#1211 fix** — the C extractor now blanks macro attributes before a
  typedef'd return type (upstream PR
  [#1223](https://github.com/colbymchenry/codegraph/pull/1223)), so functions
  shaped like `LITE_OS_SEC_TEXT_INIT UINT32 LOS_KernelInit(VOID)` are indexed
  under their real name instead of under the parameter list `(VOID)`.

**Version marker:** `codegraph --version` → `1.3.0-fmagent.N` identifies a build
from this fork.

**Releases:** tagged `vX.Y.Z-fmagent.N` on this repo, each carrying
self-contained per-OS bundles (darwin/linux, arm64/x64). FM-Agent's `install.sh`
pins one via `CODEGRAPH_VERSION`.

**Policy:** pin to a base, don't chase upstream. Upstream is tracked via the
`upstream` git remote (not a local branch). Retire this fork once upstream ships
the #1211 fix in a release.
