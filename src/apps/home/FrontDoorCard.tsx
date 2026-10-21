import { BatteryWarning, BellRing } from "lucide-react";
import { DoorbellSnapshot } from "../../components/DoorbellSnapshot";
import { whenLabel } from "../../lib/dates";
import { type FrontDoor, isBatteryLow } from "../../lib/doorbell";
import { useMinuteClock } from "../../lib/useMinuteClock";

const SNAPSHOT_REFRESH_MS = 5_000;

export function FrontDoorCard({ door }: { door: FrontDoor }) {
  const now = useMinuteClock();
  const lowBattery = isBatteryLow(door.battery);
  return (
    <section className="home-feature-card front-door-card">
      <div className="front-door-summary">
        <span className="front-door-icon"><BellRing aria-hidden="true" /></span>
        <div>
          <span>Doorbell</span>
          <h2>Front door</h2>
          <small>{door.lastRing ? `Last rang ${whenLabel(door.lastRing, now)}` : "No rings yet"}</small>
        </div>
        {door.battery !== null && <strong className={lowBattery ? "is-warning" : undefined}>{Math.round(door.battery)}% battery</strong>}
      </div>
      {lowBattery && <p className="home-feature-warning"><BatteryWarning aria-hidden="true" />Doorbell battery is low. Charge it soon.</p>}
      {/* Only there if Home Assistant can get a picture from the doorbell. */}
      <DoorbellSnapshot refreshMs={SNAPSHOT_REFRESH_MS} className="front-door-picture" />
    </section>
  );
}
