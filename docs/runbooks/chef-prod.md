# Putting Chef live on prod

Prod is `resolute-dalmatian-719`, the backend the wall uses. This sets Chef up there the way it's set up on dev (`flippant-sheep-839`): the board, cloud builds billed to the `mikec` team, `mike` as admin, a "Ship it" deploy key for prod, and the emails with Approve, Reject and Ship it. Cloud builds stay off until the last step. Run everything from the repo root, on `main`, with a clean tree and `.env.local` in place. Commands with `--prod` hit prod.

Tested on dev on 22 Oct 2026: the setup below (without `--prod`), three requests from the wall (typed, and a screenshot with a voice note), the emails' Approve link (GET changed nothing, POST approved it, a second use was refused), Reject on another request, and a Ship it page for a build that doesn't exist (refused). Cloud builds were never turned on, so no build or real Ship it has run. The emails were all attempted and refused by the Resend gateway with `domain_not_verified` (step 1).

## 0. Before you start

- Merge the branch into `main` **with a merge commit or a fast-forward, not a squash**. Dev's Chef repo has these commits as its `main`, and `pnpm convex:dev` runs `chef guard` first, which refuses a checkout without them. If it was squashed anyway, `git pull chef-dev main` (after step 3) or `CHEF_SKIP_DEPLOY_GUARD=1` for dev.
- **The merge deploys to prod.** The "Deploy production" workflow runs `convex deploy` on every push to `main`. This one installs the `feedback`, `chefCloud` and `staticHosting` components, the `chefLinks` table, `chef:*`, `chefWall:token`, `/chef/link`, `/chef-agent/*`, and static hosting's catch-all under every other route. No change to Cannvas's own tables. It now runs `pnpm exec chef guard --prod` first (with `fetch-depth: 0`); before step 3 that passes with "Chef's cloud builds aren't set up on this deployment yet". It also ends with a new step, "Move Chef's main to the deployed commit" (`deploy/chef-follow-github.sh`), which before step 4 passes with "Chef has no repo on this deployment yet". Check the run is green. If the guard step fails with a CLI error rather than "chef's main is at ...", it's the guard misreading CI, not a rollback: fix it, or set `CHEF_SKIP_DEPLOY_GUARD=1` on that step for one run.
- Back up: Dashboard > prod > Backups > Backup now.

## 1. The sending domain (Mike, once, for the whole team)

Chef's emails go through its bundled Resend in gateway mode, which only sends from a domain the `mikec` team added and verified through the gateway. The team has none yet. The sender is `Cannvas <chef@mail.mikecann.app>`.

1. Add the domain (from this checkout; dev is fine, it's the same team):

   ```sh
   npx convex run --component chefCloud/resend domains:createDomain '{"config":{},"name":"mail.mikecann.app"}'
   ```

   It prints the domain's `id` and its `records`: usually an MX and a TXT (SPF) on `send.mail`, and a TXT (DKIM) on `resend._domainkey.mail`.
2. Cloudflare > mikecann.app > DNS > Records: add each record exactly as printed (type, name, value, MX priority), **DNS only** (grey cloud), TTL Auto.
3. Verify, then check until `status` is `verified` (minutes, sometimes longer):

   ```sh
   npx convex run --component chefCloud/resend domains:verifyDomain '{"config":{},"id":"<id>"}'
   npx convex run --component chefCloud/resend domains:getDomain '{"config":{},"id":"<id>"}'
   ```

A different sender: `npx convex env set CHEF_EMAIL_FROM 'Cannvas <chef@your.domain>'` (and `--prod`).

## 2. Check prod has what the wall's sign-in needs

The wall signs in to Chef with a token signed by Convex Auth's key. Names only:

```sh
npx convex env list --prod | awk -F= '/^[A-Z_][A-Z0-9_]*=/{print $1}'
```

You want `JWT_PRIVATE_KEY`, `JWKS` and `CANNVAS_DEVICE_TOKEN`. If the first two are missing, set them up as Convex Auth's docs say (`npx @convex-dev/auth --prod`), or the sheet says it can't send.

## 3. The git remote

The CLI always calls its remote `chef`, and dev's setup took that name (it's in the shared `.git/config`, so every worktree has it). Prod gets its own repo, so move dev's aside first:

```sh
git remote rename chef chef-dev
```

Its credential helper is keyed by URL, so `chef-dev` keeps working.

## 4. Set it up

```sh
pnpm test
npx chef init --cloud --prod --admin mike --deploy-key --skip-beta
```

This is a production deploy (`npx convex deploy`), of the same code the merge deployed. Then it:
- creates prod's `cannvas` repo on Code Storage, pushes HEAD as its `main`, and adds a `chef` remote for it;
- creates a preview deploy key (`CHEF_PREVIEW_DEPLOY_KEY` on prod);
- names `mike` the admin (the email links act as `mike`; nobody can sign in as it);
- creates a deploy key for prod and records it (`CHEF_DEPLOY_KEY`), for "Ship it".

Expect it to end with "Cloud builds are off". From now on, every push to GitHub `main` deploys prod and then moves prod's Chef `main` to that commit (the workflow's last step), so Chef builds from what's live. Check the next workflow run's last step says "Chef's main is <sha>". If it fails with "git push failed" or "Syncing now would be refused", someone shipped between the guard and the sync: run `deploy/ship-from-chef.sh`. Then check, names only:

```sh
npx chef status --prod
npx convex env list --prod | awk -F= '/^[A-Z_][A-Z0-9_]*=/{print $1}'
```

You want `adminUserId: mike`, `deployKeyPrefix: prod:resolute-dalmatian-719`, `previewKeyPrefix: preview:mikec:cannvas`, `repo: cannvas`, `contract: 16`, `email: true` and `cloud builds  off`.

## 5. The wall

```sh
deploy/deploy.sh
```

Check on the Pi (AGENTS.md has the screenshot command): More has "Suggest a feature", and it opens Chef's sheet in the middle of the screen. Send one request. Within a minute mike.cann@gmail.com gets "[Cannvas] New request #1 ...". Press Reject (or Approve and build: with cloud builds off it waits). The page asks you to confirm; confirm, and the wall's sheet shows it as Declined (or Planned).

## 6. Dev afterwards

Dev keeps a working Chef for trying Chef itself. Its "Ship it" key still points at dev, so `pnpm convex:dev` stays guarded there: `git pull chef-dev main` if it refuses. Dev never builds unless someone turns cloud builds on there.

## 7. Turn cloud builds on (only when Mike says go)

Each request Mike approves is then built and billed to the team's Convex bill: about $1 to $2 a build in model calls (capped at $20), plus sandbox time, a preview deployment and up to 2 warm snapshots.

```sh
npx convex run chef:chefEnableCloudBuilds '{}' --prod
npx chef status --prod      # cloud builds  on
```

## After a ship

"Ship it" (in the "ready" email) deploys the build's backend to prod, publishes its token-less frontend to prod's static hosting (`https://resolute-dalmatian-719.convex.site`, a sample-data copy of the wall that nothing uses), and moves `main` in Chef's repo. The wall itself changes when you run:

```sh
deploy/ship-from-chef.sh
```

It fast-forwards `main` to Chef's, pushes it to GitHub (whose workflow deploys the same backend again, and the public site) and deploys the Pi. It refuses, before pushing or deploying anything, if GitHub's `main` or your checkout has commits Chef's `main` doesn't, so it only ever deploys exactly what Chef shipped. Run it soon after a ship: until then the wall's old frontend talks to the new backend. Cannvas keeps working on its local data if a call fails ("Backup paused"), but a build that renames or removes a function the wall calls, or makes a field required, can break that feature on the wall until it's deployed. The Ship card flags schema changes.

Don't push to GitHub `main` between a ship and `ship-from-chef.sh`: the workflow's guard refuses to deploy a `main` without Chef's, and says `git pull chef main`.

**When GitHub moves while a build waits.** A build starts from Chef's `main`. If a push to GitHub moves it (through the workflow's last step) before or during Ship it, Chef doesn't deploy the old base: the ship's first step sees `main` moved and queues a release merge (Chef's `followMain`; `docs/chef-pipeline.md`, "When main moves under Ship it"). That merges the new `main` into the build, runs every check again (one more build's cost), and ships on the same approval if the change is the same. If the merge needed resolving, or main moved three times, it waits for an approval in Chef's admin panel, which Cannvas doesn't mount: until it does, approve it with `npx convex run` as `mike`, or Ship a newer build that covers the same requests.

## Turning it off

```sh
npx convex run chef:chefDisableCloudBuilds '{"reason":"off"}' --prod
```

The board and the emails keep working. Chef's runbook (`node_modules/@convex-dev/feedback/skills/convex-chef/SKILL.md`, "Turning it off") has the full removal.
