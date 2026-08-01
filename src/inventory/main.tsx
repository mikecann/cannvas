import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { InventoryExperience } from "./InventoryExperience";
import "./inventory.css";

document.title = "Cannvas Inventory";
document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#163c38");

function InventoryRoot() {
  const client = useMemo(() => {
    const url = import.meta.env.VITE_CONVEX_URL;
    if (!url) throw new Error("VITE_CONVEX_URL is not configured.");
    return new ConvexReactClient(url);
  }, []);
  return (
    <ConvexAuthProvider client={client} storageNamespace="cannvas-inventory">
      <InventoryExperience mode="mobile" />
    </ConvexAuthProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <InventoryRoot />
  </StrictMode>,
);
