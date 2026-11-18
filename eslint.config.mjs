import mikecannLint from "mikecann-lint";

// cloudflare/worker.ts has its own wrangler types and sits outside the tsconfigs.
export default await mikecannLint({ root: import.meta.dirname, untyped: ["cloudflare/**"] });
