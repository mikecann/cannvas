import type { HomeAssistantEntity } from "../../lib/homeAssistant";

export const FAMILY = [
  { id: "mike", name: "Mike", avatar: "/avatars/dad.png", matches: ["mike", "cann"] },
  { id: "kelsie", name: "Kelsie", avatar: "/avatars/mum.png", matches: ["kelsie", "kels"] },
] as const;

export function familyMemberFor(person: HomeAssistantEntity) {
  const haystack = `${person.entityId} ${person.name}`.toLowerCase();
  return FAMILY.find((member) => member.matches.some((match) => haystack.includes(match)));
}
