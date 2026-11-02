// Threadbear patch (Threadbear's docs/protocol.md, "Patches"): Cannvas' pages one click away, its
// Chef requests, and a guard against the trap that lost Retic: the Pi deploys from main, so a
// feature that's only on a branch vanishes on the next deploy. "On the Pi" says what the wall is
// really running against main, and which branches hold work that main doesn't have.

type Ctx = { sh: (command: string) => Promise<string> };
type Request = { number: number; title?: string; description?: string; state: string; changelog?: string; completedAt?: number };
type PiState = { sha?: string; onMain: boolean; behind: number; branches: { name: string; when: string; subject: string }[] };

const KEEP_MS = 15 * 60 * 1000;
const PI_KEEP_MS = 5 * 60 * 1000;

// One fetch at a time and one answer until `keep` is up, however many functions ask.
function kept<T>(keep: number, load: (sh: Ctx["sh"]) => Promise<T>) {
  let cached: { at: number; value: T } | undefined;
  let pending: Promise<T> | undefined;
  return (sh: Ctx["sh"]): Promise<T> => {
    if (cached && Date.now() - cached.at < keep) return Promise.resolve(cached.value);
    pending ??= load(sh)
      .then((value) => {
        cached = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}

const requests = kept(KEEP_MS, async (sh) =>
  (await sh("npx convex data items --component feedback --prod --format jsonLines --limit 200"))
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Request),
);

const pi = kept(PI_KEEP_MS, async (sh): Promise<PiState> => {
  await sh("git fetch -q origin main");
  // Releases are named <date>-<time>-<sha>; the Pi's `current` link points at the live one.
  const sha = (await sh("ssh -o ConnectTimeout=4 -o BatchMode=yes cannvas readlink /opt/cannvas/current")).trim().split("-").pop();
  const onMain = (await sh(`git merge-base --is-ancestor ${sha} origin/main && echo yes || echo no`)).trim() === "yes";
  const behind = onMain ? Number((await sh(`git rev-list --count ${sha}..origin/main`)).trim()) : 0;
  // A squash merge leaves its branch looking unmerged to git, so GitHub says which ones landed.
  const merged = new Set(JSON.parse(await sh("gh pr list --state merged --limit 200 --json headRefName")).map((pr: { headRefName: string }) => pr.headRefName));
  const branches = (await sh(`git branch -a --no-merged origin/main --sort=-committerdate --format='%(refname:short)%09%(committerdate:relative)%09%(subject)'`))
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, when, subject] = line.split("\t");
      return { name: name.replace(/^origin\//, ""), when, subject };
    })
    .filter((b, i, all) => !merged.has(b.name) && all.findIndex((x) => x.name === b.name) === i);
  return { sha, onMain, behind, branches };
});

const isOpen = (r: Request) => r.state !== "completed" && r.state !== "rejected";

export default {
  icon: "rectangle.on.rectangle",
  actions: [
    { title: "Website", icon: "safari", url: "https://cannvas.mikecann.app/" },
    { title: "Inventory", icon: "shippingbox", url: "https://inventory.mikecann.app/" },
    { title: "Sentry", icon: "exclamationmark.triangle", url: "https://mikec.sentry.io/issues/?project=4512336957014016" },
    {
      title: "Build the next request",
      icon: "hammer",
      note: "Shows when someone has asked for something in Chef",
      prompt: "Look at the open Chef requests on Cannvas' prod (`npx convex data items --component feedback --prod --format jsonLines`), then build the oldest one that's been approved, and deploy it to the Pi. Ask me if none has.",
      when: async ({ sh }: Ctx) => (await requests(sh)).some(isOpen),
      badge: async ({ sh }: Ctx) => (await requests(sh)).filter(isOpen).length,
    },
  ],
  panels: [
    {
      title: "On the Pi",
      icon: "cpu",
      note: "What the wall runs against main, and work that isn't on main",
      // Lights up only for the dangerous case: a next deploy would take something off the wall.
      badge: async ({ sh }: Ctx) => ((await pi(sh)).onMain ? 0 : 1),
      items: async ({ sh }: Ctx) => {
        let p: PiState;
        try {
          p = await pi(sh);
        } catch (error) {
          return [{ title: "Couldn't read the Pi", detail: String(error).slice(0, 200), icon: "wifi.slash", tone: "failed" }];
        }
        const head = !p.onMain
          ? { title: `The Pi is running ${p.sha}, which isn't on main`, detail: "The next deploy from main takes that work off the wall", icon: "exclamationmark.triangle", tone: "failed" }
          : p.behind
            ? { title: `The Pi is ${p.behind} ${p.behind === 1 ? "commit" : "commits"} behind main`, detail: `Running ${p.sha}`, icon: "arrow.down.circle", tone: "attention" }
            : { title: "The Pi is on the latest main", detail: `Running ${p.sha}`, icon: "checkmark.circle", tone: "done" };
        return [
          head,
          ...p.branches.slice(0, 8).map((b) => ({ title: b.name, detail: `Not on main · ${b.when} · ${b.subject}`, icon: "arrow.triangle.branch" })),
        ];
      },
    },
    {
      title: "Chef requests",
      icon: "text.bubble",
      badge: async ({ sh }: Ctx) => (await requests(sh)).filter(isOpen).length,
      items: async ({ sh }: Ctx) => {
        const all = await requests(sh);
        const open = all.filter(isOpen).map((r) => ({ title: `#${r.number} ${r.title ?? r.description ?? ""}`.trim(), detail: r.state, icon: "text.bubble", tone: "attention" }));
        const shipped = all
          .filter((r) => r.state === "completed" && r.changelog)
          .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
          .slice(0, 5)
          .map((r) => ({ title: `#${r.number} ${r.title ?? ""}`.trim(), detail: r.changelog, icon: "checkmark.circle" }));
        return [...(open.length ? open : [{ title: "Nothing waiting", tone: "done" }]), ...shipped];
      },
    },
  ],
};
