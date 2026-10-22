// Chef: the panel's API (exposeChefApi) and cloud builds (chefCloud).
// Laid out by `npx chef init --cloud`, then given Cannvas's identity and
// options (README, "Chef (feature requests and cloud builds)").
import { exposeChefApi } from "@convex-dev/feedback";
import { chefCloud } from "@convex-dev/chef-cloud";
import { components, internal } from "./_generated/api";
import { chefNotifySend, CHEF_OWNER_EMAIL } from "./chefMail";
import { chefUserIdFromIdentity, WALL_USER_ID } from "./lib/chefWall";

export const {
  agentState, listPublicItems, submitRequest, upvoteRequest, answerRefinement, skipRefinement,
  generateUploadUrl, submitRequestWithMedia, listAttachments,
  mine, amAdmin, whoAmI, awaitingApproval, review, whatsNew,
  myNotifications, markNotificationsRead,
  approvalSnapshot, prepareApproval, approveSnapshot, runLogs, skillFeedback,
  approvalRequests, approveApprovalRequest, declineApprovalRequest, runScreenshots,
  runStatus, recentRuns, buildState, buildInCloud,
  shipCandidate, shipDiffChunk, shipApprove,
  retryRun, appLearnings, forgetLearning, buildCosts, applyRepair, buildCard,
  previewDataMode, setPreviewData, splitFromBatch, fixRequest, removeRequest,
} = exposeChefApi(components.feedback, {
  // The wall (with its device token's auth token) is "cannvas-wall", a member.
  // Every other caller is signed out. Nobody calling these is ever the admin.
  getUserId: async (ctx) => chefUserIdFromIdentity(await ctx.auth.getUserIdentity(), process.env.CONVEX_SITE_URL),
  getUserName: async (_ctx, userId) => (userId === WALL_USER_ID ? "the wall" : null),
  // Email Mike each request that's waiting for him, with Approve and Reject.
  onSubmitted: async (ctx, request) => {
    if (request.state !== "submitted") return;
    await ctx.scheduler.runAfter(0, internal.chefMail.sendRequestEmail, { itemId: request.itemId });
  },
});

// Cloud builds: the build steps and sweeps, setup and the on switch, the
// deploy keys, and the app's repo on Code Storage. All internal; the
// workflows, the feedback component and `npx chef` (through `npx convex run`) call them.
export const {
  chefStep, chefSweep, chefCleanup, chefRunStart, chefShipStart, chefReconcile,
  chefSetup, chefSetupStatus, chefEnableCloudBuilds, chefDisableCloudBuilds, chefCreateWorkerKey,
  chefSetAdmin, chefSetPreviewDeployKey, chefSetDeployKey, chefCancelRun, chefMigrateAgentKeys,
  chefRepoSetup, chefRepoUploadUrl, chefRepoPushPack, chefGitCredential, chefRepoRefs, chefRepairApply, chefIos, chefPlanBatches, chefCiCheck,
} = chefCloud(components.feedback, components.chefCloud, {
  appName: "Cannvas",
  repoName: "cannvas",
  // The wall's Vite build. A build sandbox has no device token, so a preview
  // shows the wall on its built-in sample data, as `pnpm dev` does without a
  // backend, and has no "Suggest a feature".
  frontend: { command: ["npm", "run", "build"], urlEnvVar: "VITE_CONVEX_URL", distDir: "dist" },
  // Chef's own emails (built, failed, shipped) go through the same mailer as
  // the request emails, so "built" gets a Ship it button (convex/chefMail.ts).
  notify: { to: CHEF_OWNER_EMAIL, send: chefNotifySend },
});
