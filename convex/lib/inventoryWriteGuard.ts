// The retained source must stay frozen, including work scheduled before cutover.
export function inventoryWritesPaused() {
  return process.env.INVENTORY_READ_ONLY === "1";
}
