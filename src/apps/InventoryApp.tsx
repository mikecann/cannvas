import { PackageSearch, Smartphone } from "lucide-react";

const INVENTORY_URL = "https://cannvas.mikecann.app/inventory/";

export function InventoryApp() {
  return (
    <section className="inventory-handoff">
      <div className="inventory-handoff-copy">
        <div className="inventory-handoff-icon" aria-hidden="true"><PackageSearch /></div>
        <h1>Open Inventory on your phone</h1>
        <p>Point your phone camera at the code, then tap the link that appears.</p>
        <div className="inventory-handoff-url">
          <Smartphone aria-hidden="true" />
          <span>cannvas.mikecann.app/inventory</span>
        </div>
      </div>

      <div className="inventory-qr-card">
        <img src="/inventory-qr.png" alt={`QR code for ${INVENTORY_URL}`} />
      </div>

      <p className="inventory-handoff-note">The TV stays signed out. Your inventory remains private on your phone.</p>
    </section>
  );
}
