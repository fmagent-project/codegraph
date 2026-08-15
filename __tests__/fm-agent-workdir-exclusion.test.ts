/**
 * FORK-SPECIFIC (see FORK.md): FM-Agent's work directory is excluded by default.
 *
 * FM-Agent writes an `fm_agent/` directory into the project it analyses, holding
 * one copy of every function it extracts plus the scripts it stages to produce
 * them. Indexing that lists each function twice and mixes tool output in with
 * project code, so `fm_agent` sits in DEFAULT_IGNORE_DIRS.
 *
 * The patch is one line in a name set, which is exactly the kind of change a
 * later upstream merge can silently drop or widen. These tests pin down what it
 * is supposed to do — and, just as importantly, what it must NOT do:
 *
 *  - It matches a DIRECTORY named exactly `fm_agent`, at any depth. Matching at
 *    any depth is deliberate: FM-Agent's work directory sits at the root of the
 *    directory it was pointed at, which is not necessarily the root CodeGraph
 *    indexes (run FM-Agent on `packages/product` but open an editor session at
 *    the monorepo root, and the artifacts are nested).
 *  - It is a whole-name match, not a prefix or substring one, so `fm_agent_data/`
 *    and `my_fm_agent/` stay indexed. This is what keeps the blast radius small.
 *  - A project that legitimately owns an `fm_agent/` directory takes it back with
 *    a `.gitignore` negation, as for any other default-ignored directory. That
 *    escape hatch is the reason the any-depth match is acceptable, so it is
 *    covered here rather than left to documentation.
 *  - The exclusion is independent of git: it holds with no repository at all, and
 *    with the artifacts committed. The second case is not hypothetical — FM-Agent's
 *    incremental mode indexes a temporary worktree checked out from a commit that
 *    can contain them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import CodeGraph from '../src/index';

const C_FN = 'int extracted(int n) { return n + 1; }\n';
const PY_FN = 'def extracted(n):\n    return n + 1\n';

describe("FM-Agent work directory exclusion (fork-only)", () => {
  const open: CodeGraph[] = [];
  const dirs: string[] = [];

  const scratch = (tag: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `codegraph-fmagent-${tag}-`));
    dirs.push(dir);
    return dir;
  };

  const write = (dir: string, rel: string, body: string) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };

  const indexOf = async (dir: string) => {
    const cg = CodeGraph.initSync(dir);
    open.push(cg);
    await cg.indexAll();
    return new Set(cg.getFiles().map((f) => f.path));
  };

  const git = (dir: string, ...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });

  afterEach(() => {
    while (open.length) open.pop()!.destroy();
    while (dirs.length) {
      const d = dirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('excludes fm_agent/ at the project root and at any nested depth, in any language', async () => {
    const dir = scratch('core');
    write(dir, 'src/app.c', 'int main(void) { return 0; }\n');
    write(dir, 'packages/product/real.c', 'int helper(void) { return 1; }\n');

    // Root-level artifacts, both languages FM-Agent extracts into.
    write(dir, 'fm_agent/extracted_functions/src-c/extracted.c', C_FN);
    write(dir, 'fm_agent/extracted_functions/src-py/extracted.py', PY_FN);

    // Nested artifacts: FM-Agent ran on `packages/product`, CodeGraph indexes the
    // repository root.
    write(dir, 'packages/product/fm_agent/extracted_functions/x-c/extracted.c', C_FN);

    const indexed = await indexOf(dir);

    expect(indexed).not.toContain('fm_agent/extracted_functions/src-c/extracted.c');
    expect(indexed).not.toContain('fm_agent/extracted_functions/src-py/extracted.py');
    expect(indexed).not.toContain('packages/product/fm_agent/extracted_functions/x-c/extracted.c');

    // Real source on both sides of the excluded directory is untouched.
    expect(indexed).toContain('src/app.c');
    expect(indexed).toContain('packages/product/real.c');
  });

  it('matches the whole directory name only, so lookalike names stay indexed', async () => {
    const dir = scratch('lookalike');
    write(dir, 'src/app.c', 'int main(void) { return 0; }\n');
    write(dir, 'fm_agent_data/loader.c', C_FN);   // longer name
    write(dir, 'my_fm_agent/plugin.c', C_FN);     // longer name, other side
    write(dir, 'agent/fm_agent.c', C_FN);         // a FILE, not a directory
    write(dir, 'fm_agent/extracted_functions/x-c/extracted.c', C_FN);  // the real thing

    const indexed = await indexOf(dir);

    expect(indexed).toContain('fm_agent_data/loader.c');
    expect(indexed).toContain('my_fm_agent/plugin.c');
    expect(indexed).toContain('agent/fm_agent.c');
    expect(indexed).toContain('src/app.c');
    expect(indexed).not.toContain('fm_agent/extracted_functions/x-c/extracted.c');
  });

  it('lets a project take fm_agent/ back with a .gitignore negation, nested included', async () => {
    const dir = scratch('negation');
    write(dir, '.gitignore', '!fm_agent/\n');
    write(dir, 'src/app.c', 'int main(void) { return 0; }\n');
    write(dir, 'fm_agent/service.c', C_FN);
    write(dir, 'packages/product/fm_agent/handler.c', C_FN);

    const indexed = await indexOf(dir);

    expect(indexed).toContain('fm_agent/service.c');
    expect(indexed).toContain('packages/product/fm_agent/handler.c');
    expect(indexed).toContain('src/app.c');
  });

  it('excludes fm_agent/ whether or not there is a repository, and whether or not it is committed', async () => {
    // No repository at all.
    const plain = scratch('nogit');
    write(plain, 'src/app.c', 'int main(void) { return 0; }\n');
    write(plain, 'fm_agent/extracted_functions/x-c/extracted.c', C_FN);
    const plainIndexed = await indexOf(plain);
    expect(plainIndexed).toContain('src/app.c');
    expect(plainIndexed).not.toContain('fm_agent/extracted_functions/x-c/extracted.c');

    // A repository with the artifacts tracked and committed — the shape
    // FM-Agent's incremental mode checks out into a temporary worktree.
    const repo = scratch('tracked');
    write(repo, 'src/app.c', 'int main(void) { return 0; }\n');
    write(repo, 'fm_agent/extracted_functions/x-c/extracted.c', C_FN);
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'test');
    git(repo, 'add', '-A');
    git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'with artifacts');
    // Precondition: the artifacts really are tracked, so this is not a no-op.
    expect(git(repo, 'ls-files').toString()).toContain('fm_agent/extracted_functions/x-c/extracted.c');

    const repoIndexed = await indexOf(repo);
    expect(repoIndexed).toContain('src/app.c');
    expect(repoIndexed).not.toContain('fm_agent/extracted_functions/x-c/extracted.c');
  });
});
