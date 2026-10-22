import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import feedback from "@convex-dev/feedback/convex.config.js";
import chefCloud from "@convex-dev/chef-cloud/convex.config.js";
import staticHosting from "@convex-dev/static-hosting/convex.config.js";

const app = defineApp();
app.use(agent);

// Chef: requests and approvals (feedback), and cloud builds (chefCloud).
app.use(feedback);
app.use(chefCloud);
// Only for Chef: a build's preview serves the wall's frontend from here, and
// "Ship it" publishes it here too. The wall itself is served from the Pi.
app.use(staticHosting);

export default app;
