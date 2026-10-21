import { Video } from "lucide-react";
import { useState } from "react";
import type { HomeAssistantEntityStatus } from "../../lib/homeAssistant";
import { readJsonResponse } from "../../lib/http";
import { isFilming, KEY_LIGHTS } from "../../lib/keyLights";
import { usePolling } from "../../lib/usePolling";

const REFRESH_MS = 10_000;

/** A small note on the home screen while Mike's Key Lights are on, so nobody barges in. */
export function FilmingBanner() {
  const [filming, setFilming] = useState(false);

  usePolling(async (signal) => {
    try {
      const lights = await Promise.all(KEY_LIGHTS.map(async (id) => {
        const response = await fetch(`/api/home-assistant/entity?id=${id}`, { cache: "no-store", signal });
        return (await readJsonResponse<HomeAssistantEntityStatus>(response, "The Key Lights are unavailable")).entity;
      }));
      setFilming(isFilming(lights));
    } catch {
      // Keep the last reading through a brief Home Assistant or Wi-Fi blip.
    }
  }, REFRESH_MS);

  if (!filming) return null;
  return (
    <div className="filming-banner" role="status">
      <span className="filming-dot" aria-hidden="true" />
      <Video aria-hidden="true" />
      Dad's filming
    </div>
  );
}
