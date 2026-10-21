import type { HomeAssistantAction } from "./homeAssistant";
import { readJsonResponse } from "./http";
import type { VacuumAction } from "./vacuum";

/**
 * Ask the Pi server to run a Home Assistant action. Throws with the server's message when it fails.
 * `preset` names a room clean the server knows, for the vacuum's clean_area.
 */
export async function runHomeAssistantAction(entityId: string, action: HomeAssistantAction | VacuumAction, fallback: string, preset?: string) {
  const response = await fetch("/api/home-assistant/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityId, action, ...(preset ? { preset } : {}) }),
  });
  await readJsonResponse(response, fallback);
}
