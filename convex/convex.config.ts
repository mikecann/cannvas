import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config.js";

const app = defineApp();
app.use(agent);
app.use(staticHosting);

export default app;
