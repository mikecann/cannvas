import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { GiveawayExperience } from "./GiveawayExperience";
import "./giveaway.css";

function GiveawayRoot() {
  const client = useMemo(() => {
    const url = import.meta.env.VITE_CONVEX_URL;
    if (!url) throw new Error("VITE_CONVEX_URL is not configured.");
    return new ConvexReactClient(url);
  }, []);

  return (
    <ConvexProvider client={client}>
      <GiveawayExperience />
    </ConvexProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GiveawayRoot />
  </StrictMode>,
);
