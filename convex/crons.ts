import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("poll Google Tasks", { minutes: 2 }, internal.googleTasks.poll, {});

export default crons;
