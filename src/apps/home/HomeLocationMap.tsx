import { House } from "lucide-react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import type { HomeAssistantEntity } from "../../lib/homeAssistant";
import { familyMemberFor } from "./family";

type LocationGroup = {
  key: string;
  names: string;
  avatars: string[];
  latitude: number;
  longitude: number;
};

function groupLocations(people: HomeAssistantEntity[]): LocationGroup[] {
  const groups = new Map<string, Array<{ person: HomeAssistantEntity; latitude: number; longitude: number }>>();
  for (const person of people) {
    const { latitude: rawLatitude, longitude: rawLongitude } = person.attributes;
    // Number(null) is 0, which would put someone off the coast of Africa.
    if (rawLatitude == null || rawLongitude == null || String(rawLatitude) === "" || String(rawLongitude) === "") continue;
    const latitude = Number(rawLatitude);
    const longitude = Number(rawLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    // Trackers at home normally report identical coordinates. Group anything
    // within roughly ten metres so one family member cannot hide another.
    const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const group = groups.get(key) ?? [];
    group.push({ person, latitude, longitude });
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    // Markers are matched by who is in them, so a person moving keeps their marker.
    key: group.map(({ person }) => person.entityId).sort().join("|"),
    names: group.map(({ person }) => person.name).join(" & "),
    avatars: group.map(({ person }) => familyMemberFor(person)?.avatar ?? "/avatars/dad.png"),
    latitude: group.reduce((sum, location) => sum + location.latitude, 0) / group.length,
    longitude: group.reduce((sum, location) => sum + location.longitude, 0) / group.length,
  }));
}

function markerIcon(group: LocationGroup) {
  const grouped = group.avatars.length > 1;
  const iconWidth = grouped ? 94 : 58;
  return L.divIcon({
    className: `home-location-marker${grouped ? " is-group" : ""}`,
    html: `<span>${group.avatars.map((avatar) => `<b><img src="${avatar}" alt=""><i></i></b>`).join("")}</span>`,
    iconSize: [iconWidth, 66],
    iconAnchor: [iconWidth / 2, 62],
  });
}

export function HomeLocationMap({ people }: { people: HomeAssistantEntity[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  // The serialized key changes only when someone's coordinates change, so the
  // 15 second status refresh doesn't touch the map otherwise.
  const locationKey = JSON.stringify(groupLocations(people));
  const groups = useMemo(() => JSON.parse(locationKey) as LocationGroup[], [locationKey]);
  const hasLocations = groups.length > 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!hasLocations || !container) return;
    const map = L.map(container, { zoomControl: false, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    const markers = markersRef.current;
    const timer = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(timer);
      map.remove();
      markers.clear();
      mapRef.current = null;
    };
  }, [hasLocations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || groups.length === 0) return;
    const markers = markersRef.current;
    const seen = new Set<string>();
    const bounds = L.latLngBounds([]);
    for (const group of groups) {
      seen.add(group.key);
      const existing = markers.get(group.key);
      if (existing) {
        existing.setLatLng([group.latitude, group.longitude]);
      } else {
        const grouped = group.avatars.length > 1;
        const marker = L.marker([group.latitude, group.longitude], { icon: markerIcon(group) }).addTo(map);
        // Names come from Home Assistant, so set them as text, never as HTML.
        const label = document.createElement("span");
        label.textContent = group.names;
        marker.bindTooltip(label, {
          permanent: true,
          direction: "right",
          offset: [grouped ? 34 : 18, -31],
          className: "home-location-label",
        });
        markers.set(group.key, marker);
      }
      bounds.extend([group.latitude, group.longitude]);
    }
    for (const [key, marker] of markers) {
      if (seen.has(key)) continue;
      marker.remove();
      markers.delete(key);
    }
    if (groups.length === 1) map.setView(bounds.getCenter(), 15);
    else map.fitBounds(bounds.pad(.35), { maxZoom: 15 });
  }, [groups, hasLocations]);

  if (!hasLocations) {
    return <div className="home-location-empty"><House /> Location will appear when a person tracker reports GPS coordinates.</div>;
  }
  return <div ref={containerRef} className="home-location-map" aria-label="Map showing family locations" />;
}
