"use node";

import ical, { type Attendee, type EventInstance, type ParameterValue, type VEvent } from "node-ical";
import { v } from "convex/values";
import { action } from "./_generated/server";

const MAX_RANGE_MS = 370 * 24 * 60 * 60 * 1000;

function textValue(value: ParameterValue | undefined) {
  if (!value) return "";
  return typeof value === "string" ? value : value.val;
}

function calendarIdFromFeed(feedUrl: string) {
  try {
    const parts = new URL(feedUrl).pathname.split("/");
    return decodeURIComponent(parts[3] ?? "").toLowerCase();
  } catch {
    return "";
  }
}

function attendeeValue(attendee: Attendee) {
  return (typeof attendee === "string" ? attendee : attendee.val)
    .replace(/^mailto:/i, "")
    .toLowerCase();
}

function isDeclinedByCalendarOwner(event: VEvent, calendarId: string) {
  if (!calendarId || !event.attendee) return false;
  const attendees = Array.isArray(event.attendee) ? event.attendee : [event.attendee];
  return attendees.some((attendee) => {
    const params = typeof attendee === "string" ? undefined : attendee.params;
    return attendeeValue(attendee) === calendarId && params?.PARTSTAT === "DECLINED";
  });
}

function toCalendarEvent(event: VEvent, instance: EventInstance) {
  const source = instance.event ?? event;
  return {
    id: `${event.uid}:${instance.start.toISOString()}`,
    title: textValue(instance.summary) || "Untitled event",
    start: instance.start.toISOString(),
    end: instance.end.toISOString(),
    allDay: instance.isFullDay,
    location: textValue(source.location) || undefined,
  };
}

export const events = action({
  args: {
    accessToken: v.string(),
    start: v.string(),
    end: v.string(),
  },
  handler: async (_ctx, args) => {
    const feedUrl = process.env.GOOGLE_CALENDAR_ICAL_URL;
    const expectedToken = process.env.CALENDAR_ACCESS_TOKEN;
    if (!feedUrl || !expectedToken || args.accessToken !== expectedToken) {
      return { configured: false, events: [] };
    }

    const parsedUrl = new URL(feedUrl);
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "calendar.google.com" || !parsedUrl.pathname.startsWith("/calendar/ical/")) {
      throw new Error("Calendar feed must be a Google Calendar iCal URL");
    }

    const rangeStart = new Date(args.start);
    const rangeEnd = new Date(args.end);
    if (!Number.isFinite(rangeStart.getTime()) || !Number.isFinite(rangeEnd.getTime()) || rangeEnd <= rangeStart || rangeEnd.getTime() - rangeStart.getTime() > MAX_RANGE_MS) {
      throw new Error("Invalid calendar range");
    }

    const response = await fetch(feedUrl, { headers: { "User-Agent": "Cannvas family display" } });
    if (!response.ok) throw new Error(`Calendar feed returned ${response.status}`);
    const components = ical.sync.parseICS(await response.text());
    const calendarId = calendarIdFromFeed(feedUrl);
    const result = Object.values(components).flatMap((component) => {
      if (!component || component.type !== "VEVENT") return [];
      const event = component as VEvent;
      if (event.status === "CANCELLED" || isDeclinedByCalendarOwner(event, calendarId)) return [];

      return ical.expandRecurringEvent(event, {
        from: rangeStart,
        to: rangeEnd,
        includeOverrides: true,
        excludeExdates: true,
        expandOngoing: true,
      })
        .filter((instance) => instance.start < rangeEnd && instance.end > rangeStart)
        .map((instance) => toCalendarEvent(event, instance));
    });

    return {
      configured: true,
      events: result
        .sort((left, right) => left.start.localeCompare(right.start))
        .slice(0, 750),
    };
  },
});
