import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "chef-follow-github.sh");
const REPO_URL = "https://git.code.storage/cvx-test/cannvas.git";

// A checkout with the real chef-follow-github.sh and pnpm stubbed out:
// `pnpm exec convex run` answers with $STATUS (or fails with $STATUS_ERROR),
// and `pnpm exec chef sync --prod` is recorded in `calls`.
async function setup(context) {
  const root = await mkdtemp(join(tmpdir(), "cannvas-follow-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const work = join(root, "work");
  const bin = join(root, "bin");
  const calls = join(root, "calls");
  await mkdir(join(work, "deploy"), { recursive: true });
  await mkdir(bin);
  const git = (...args) => execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "--allow-empty", "-m", "deployed");
  await copyFile(script, join(work, "deploy", "chef-follow-github.sh"));
  await writeFile(
    join(bin, "pnpm"),
    `#!/usr/bin/env bash
echo "$*" >> "${calls}"
if [ "$2" = convex ]; then
  if [ -n "\${STATUS_ERROR:-}" ]; then echo "$STATUS_ERROR" >&2; exit 1; fi
  echo "$STATUS"
fi
exit 0
`,
  );
  await chmod(join(bin, "pnpm"), 0o755);
  const run = (env) =>
    spawnSync("bash", ["deploy/chef-follow-github.sh"], {
      cwd: work,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STATUS: "", STATUS_ERROR: "", ...env },
    });
  const pnpmCalls = () => readFile(calls, "utf8").then((s) => s.trim().split("\n"), () => []);
  return { git, work, run, pnpmCalls };
}

test("passes and syncs nothing while Chef isn't deployed", async (context) => {
  const { run, pnpmCalls } = await setup(context);
  const result = run({ STATUS_ERROR: "Could not find public function for 'chef:chefSetupStatus'" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Chef isn't on this deployment/);
  assert.deepEqual(await pnpmCalls(), ["exec convex run --prod chef:chefSetupStatus {}"]);
});

test("passes and syncs nothing while Chef has no repo", async (context) => {
  const { git, run, pnpmCalls } = await setup(context);
  const result = run({ STATUS: JSON.stringify({ repo: "", remoteUrl: "", deployKeyPrefix: "" }) });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no repo/);
  assert.equal((await pnpmCalls()).length, 1);
  assert.equal(git("remote"), "");
});

test("fails on any other error reading Chef's status", async (context) => {
  const { run, pnpmCalls } = await setup(context);
  const result = run({ STATUS_ERROR: "network is down" });
  assert.notEqual(result.status, 0);
  assert.equal((await pnpmCalls()).length, 1);
});

test("adds Chef's remote and its credential helper, then chef sync --prod", async (context) => {
  const { git, work, run, pnpmCalls } = await setup(context);
  const result = run({ STATUS: JSON.stringify({ repo: "cannvas", remoteUrl: REPO_URL }) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git("remote", "get-url", "chef"), REPO_URL);
  // An empty helper first, so no keychain helper sees Chef's token.
  const helpers = execFileSync("git", ["config", "--get-all", `credential.${REPO_URL}.helper`], { cwd: work, encoding: "utf8" });
  assert.match(helpers, /^\n!f\(\) .*pnpm exec chef git-credential --prod/);
  assert.equal((await pnpmCalls()).at(-1), "exec chef sync --prod");
});

test("never sends credentials in a remote URL", async (context) => {
  const { git, run, pnpmCalls } = await setup(context);
  const result = run({ STATUS: JSON.stringify({ repo: "cannvas", remoteUrl: "https://user:secret@git.code.storage/x.git" }) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git("remote"), "");
  assert.equal((await pnpmCalls()).length, 1);
});
