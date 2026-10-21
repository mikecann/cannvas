import { BatteryWarning, BellRing, Footprints } from "lucide-react";
import { DoorbellSnapshot } from "../../components/DoorbellSnapshot";
import { timeAgo, whenLabel } from "../../lib/dates";
import { type FrontDoor, isBatteryLow } from "../../lib/doorbell";
import { useMinuteClock } from "../../lib/useMinuteClock";

const SNAPSHOT_REFRESH_MS = 5_000;

export function FrontDoorCard({ door }: { door: FrontDoor }) {
  const now = useMinuteClock();
  const lowBattery = isBatteryLow(door.battery);
  return (
    <section className="home-feature-card front-door-card">
      <div className="home-section-title">
        <div><span>Doorbell</span><h2>Front door</h2></div>
        {door.battery !== null && <strong className={lowBattery ? "is-warning" : undefined}>{Math.round(door.battery)}% battery</strong>}
      </div>
      <DoorbellSnapshot refreshMs={SNAPSHOT_REFRESH_MS} />
      <ul className="home-feature-facts">
        <li><BellRing aria-hidden="true" />{door.lastRing ? `Last rang ${whenLabel(door.lastRing, now)}` : "No rings yet"}</li>
        <li><Footprints aria-hidden="true" />{door.lastMotion ? `Motion at front door, ${timeAgo(door.lastMotion, now)}` : "No motion seen yet"}</li>
      </ul>
      {lowBattery && <p className="home-feature-warning"><BatteryWarning aria-hidden="true" />Doorbell battery is low. Charge it soon.</p>}
    </section>
  );
}
