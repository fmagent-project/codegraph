# Maintenance fork

FM-Agent's maintenance fork of
[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph).

**Pinned base:** upstream `v1.3.0` (this fork's `main` is reset to that tag).

**Patch on top:**
- **C macro-attribute function-name loss** — a C function shaped like
  `LITE_OS_SEC_TEXT_INIT UINT32 LOS_KernelInit(VOID)` (a macro attribute + a
  typedef'd return type + a bare `(VOID)`) was indexed under its parameter list
  `(VOID)` instead of its name. The C extractor now blanks in-file attribute
  macros before parsing (recovering both name and return type) and, when the
  macro is only `#include`d from a header, recovers the name from the misparse.

**Version marker:** `codegraph --version` → `1.3.0-fmagent.N` identifies a build
from this fork.

**Releases:** tagged `vX.Y.Z-fmagent.N`, each carrying self-contained per-OS
bundles (darwin/linux, arm64/x64). FM-Agent's `install.sh` pins one via
`CODEGRAPH_VERSION`.

**Policy:** pin to a base, don't chase upstream. Upstream is tracked via the
`upstream` git remote (not a local branch). Retire once upstream ships the fix
in a release.
