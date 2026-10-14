import type { HomeAssistantAction } from "./homeAssistant";
import { readJsonResponse } from "./http";

/** Ask the Pi server to run a Home Assistant action. Throws with the server's message when it fails. */
export async function runHomeAssistantAction(entityId: string, action: HomeAssistantAction, fallback: string) {
  const response = await fetch("/api/home-assistant/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityId, action }),
  });
  await readJsonResponse(response, fallback);
}
