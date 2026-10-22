import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "ship-from-chef.sh");

// A checkout of main with a GitHub remote and a Chef remote (both bare repos),
// the real ship-from-chef.sh, and deploy/deploy.sh and pnpm stubbed out.
// deploy.sh writes the commit it would have deployed to `deployed`.
async function setup(context) {
  const root = await mkdtemp(join(tmpdir(), "cannvas-ship-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const work = join(root, "work");
  const bin = join(root, "bin");
  const git = (...args) => execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
  for (const bare of ["github.git", "chef.git"]) execFileSync("git", ["init", "-q", "--bare", "-b", "main", join(root, bare)]);
  await mkdir(join(work, "deploy"), { recursive: true });
  await mkdir(bin);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("remote", "add", "origin", join(root, "github.git"));
  git("remote", "add", "chef", join(root, "chef.git"));
  await copyFile(script, join(work, "deploy", "ship-from-chef.sh"));
  await writeFile(join(work, "deploy", "deploy.sh"), `#!/usr/bin/env bash\ngit rev-parse HEAD > "${join(root, "deployed")}"\n`);
  await chmod(join(work, "deploy", "deploy.sh"), 0o755);
  await writeFile(join(bin, "pnpm"), "#!/usr/bin/env bash\nexit 0\n");
  await chmod(join(bin, "pnpm"), 0o755);
  await writeFile(join(work, ".gitignore"), ".env.local\n");
  await writeFile(join(work, ".env.local"), "");
  const commit = (name) => {
    execFileSync("sh", ["-c", `echo ${name} > ${name}.txt`], { cwd: work });
    git("add", "-A");
    git("commit", "-q", "-m", name);
    return git("rev-parse", "HEAD");
  };
  const ship = () =>
    spawnSync("bash", ["deploy/ship-from-chef.sh"], {
      cwd: work,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
  const deployed = () => readFile(join(root, "deployed"), "utf8").then((sha) => sha.trim(), () => null);
  const remoteMain = (bare) => execFileSync("git", ["--git-dir", join(root, bare), "rev-parse", "main"], { encoding: "utf8" }).trim();
  return { git, commit, ship, deployed, remoteMain };
}

test("fast-forwards to Chef's main, pushes it and deploys it", async (context) => {
  const { git, commit, ship, deployed, remoteMain } = await setup(context);
  const a = commit("a");
  git("push", "-q", "origin", "main");
  const b = commit("b");
  git("push", "-q", "chef", "main");
  git("reset", "-q", "--hard", a);

  const result = ship();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await deployed(), b);
  assert.equal(remoteMain("github.git"), b);
});

test("refuses when this checkout has a commit Chef's main doesn't", async (context) => {
  const { git, commit, ship, deployed, remoteMain } = await setup(context);
  const b = commit("b");
  git("push", "-q", "origin", "main");
  git("push", "-q", "chef", "main");
  commit("unpushed");

  const result = ship();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /this checkout's main has commits Chef's main doesn't/);
  assert.equal(await deployed(), null);
  assert.equal(remoteMain("github.git"), b);
});

test("refuses when GitHub's main has a commit Chef's main doesn't", async (context) => {
  const { git, commit, ship, deployed, remoteMain } = await setup(context);
  const a = commit("a");
  git("push", "-q", "chef", "main");
  const g = commit("github-only");
  git("push", "-q", "origin", "main");
  git("reset", "-q", "--hard", a);

  const result = ship();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GitHub's main has commits Chef's main doesn't/);
  assert.equal(await deployed(), null);
  assert.equal(remoteMain("github.git"), g);
});
