import type { HomeAssistantEntity } from "./homeAssistant";

// Mike's two Elgato Key Lights. While either is on, he's filming.
export const KEY_LIGHTS = ["light.elgato_key_light_mk_2_e1a2", "light.elgato_key_light_mk_2_b2d7"];

export function isFilming(lights: Array<HomeAssistantEntity | null | undefined>) {
  return lights.some((light) => light?.state.toLowerCase() === "on");
}

/** "Elgato Key Light MK.2 E1A2" → "Key Light E1A2" */
export function keyLightName(light: Pick<HomeAssistantEntity, "name">) {
  return light.name.replace(/^Elgato\s+/i, "").replace(/\s*MK\.?\s*2\b/i, "");
}
