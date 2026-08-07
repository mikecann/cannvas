import { useEffect, useMemo, useState } from "react";
import { Box, LoaderCircle, MapPin, Search } from "lucide-react";

type InventoryItem = {
  _id: string;
  title: string;
  category: string;
  condition: string;
  quantity: number;
  currentLocationName: string;
  updatedAt: number;
  photoUrl: string | null;
};

type InventoryResponse = {
  configured?: boolean;
  items?: InventoryItem[];
  error?: string;
};

export function KioskInventoryApp() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/inventory")
      .then(async (response) => {
        if (!response.headers.get("Content-Type")?.includes("application/json")) {
          throw new Error("Inventory is available on the Cannvas touchscreen");
        }
        const body = await response.json() as InventoryResponse;
        if (!response.ok) throw new Error(body.error || "Inventory is temporarily unavailable");
        if (!body.configured) throw new Error("Inventory is available on the Cannvas touchscreen");
        if (active) setItems(body.items ?? []);
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : "Inventory is temporarily unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-AU");
    if (!query) return items;
    return items.filter((item) => [
      item.title,
      item.category,
      item.condition,
      item.currentLocationName,
    ].some((value) => value.toLocaleLowerCase("en-AU").includes(query)));
  }, [items, search]);

  return (
    <section className="kiosk-inventory-app">
      <header className="kiosk-inventory-header">
        <div>
          <div className="kiosk-inventory-title"><span><Box /></span><h1>Inventory</h1></div>
          <p>Find where something lives. Add or edit items from your phone.</p>
        </div>
        <label className="kiosk-inventory-search">
          <Search />
          <input
            type="search"
            aria-label="Search inventory"
            value={search}
            placeholder="Search items or locations"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </header>

      {loading && <div className="kiosk-inventory-state"><LoaderCircle className="spin" />Opening inventory…</div>}
      {!loading && message && <div className="kiosk-inventory-state"><Box /><strong>{message}</strong><span>The private phone app still requires your account.</span></div>}
      {!loading && !message && visibleItems.length === 0 && (
        <div className="kiosk-inventory-state"><Search /><strong>No matching items</strong><span>Try a different item, category, or location.</span></div>
      )}
      {!loading && !message && visibleItems.length > 0 && (
        <div className="kiosk-inventory-grid" aria-label="Household inventory">
          {visibleItems.map((item) => (
            <article className="kiosk-inventory-card" key={item._id}>
              <div className="kiosk-inventory-photo">
                {item.photoUrl ? <img src={item.photoUrl} alt="" /> : <Box />}
              </div>
              <div className="kiosk-inventory-copy">
                <span>{item.category}</span>
                <h2>{item.title}</h2>
                <p><MapPin />{item.currentLocationName}</p>
                <small>{item.condition}{item.quantity > 1 ? ` · ${item.quantity} items` : ""}</small>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
