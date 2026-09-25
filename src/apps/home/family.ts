import type { HomeAssistantEntity } from "../../lib/homeAssistant";

export const FAMILY = [
  { id: "mike", name: "Mike", avatar: "/avatars/dad.png", matches: ["mike", "cann"] },
  { id: "kelsie", name: "Kelsie", avatar: "/avatars/mum.png", matches: ["kelsie", "kels"] },
] as const;

type FamilyMember = (typeof FAMILY)[number];

/**
 * The family member a Home Assistant person belongs to. The longest match
 * wins, so "Kelsie Cann" is Kelsie even though "cann" also matches Mike.
 */
export function familyMemberFor(person: HomeAssistantEntity): FamilyMember | undefined {
  const haystack = `${person.entityId} ${person.name}`.toLowerCase();
  let best: { member: FamilyMember; length: number } | undefined;
  for (const member of FAMILY) {
    for (const match of member.matches) {
      if (haystack.includes(match) && match.length > (best?.length ?? 0)) best = { member, length: match.length };
    }
  }
  return best?.member;
}

/** The Home Assistant person for a family member, if one is tracked. */
export function familyPersonFor(people: HomeAssistantEntity[], member: FamilyMember) {
  return people.find((person) => familyMemberFor(person)?.id === member.id);
}
