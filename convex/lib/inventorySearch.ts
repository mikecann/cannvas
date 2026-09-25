export type SearchableInventoryItem = {
  title: string;
  description: string;
  category: string;
  tags: string[];
  condition: string;
  attributes: Array<{ label: string; value: string }>;
  currentLocationName: string;
};

export function buildSearchText(item: SearchableInventoryItem) {
  return [
    item.title,
    item.description,
    item.category,
    item.condition,
    item.currentLocationName,
    ...item.tags,
    ...item.attributes.flatMap(({ label, value }) => [label, value]),
  ].join(" ");
}
