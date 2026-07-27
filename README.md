# Cannvas

Cannvas is a touch-first family dashboard designed for a shared TV display.

The plan is to bring everyday household tools into one place, including a
digital whiteboard, chores and pocket money, news, weather, and more.

## Apps

- Daily vector whiteboards with date history and Convex persistence
- Joshua's weekly chore tracker and pocket-money totals
- Family to-do lists grouped by Mum, Dad, and Josh
- A monthly calendar sourced only from the primary personal Google Calendar
- An idle home display using the original Mike's Smarter Mirror family-video
  library, Yr Busselton meteogram, BBC headlines, and a seven-day calendar brief

The interface is designed for the Pi's 1080x1920 portrait touchscreen. It
returns to the home display after five minutes without pointer or keyboard
activity.

## Development

```sh
pnpm install
pnpm convex:dev
pnpm dev
```

The mirror is local-first for whiteboards, chores, and device settings. Browser
storage on the device is authoritative for those domains, and Convex receives a
revisioned backup snapshot after a 500 ms debounce.

To-do's are canonical Convex records so they can synchronize with Google Tasks
and accept quick capture from Apple Shortcuts. On the first run after this
migration, to-do's from the existing device snapshot are imported by their
legacy IDs without replacing or duplicating them.

### Google Tasks

Cannvas synchronizes Dad's to-do's with the existing Google task list named
`Personal`. It never creates a list. Active Personal tasks become Dad tasks in
Cannvas with medium priority, and new Dad tasks are added to Personal. Local
changes are sent immediately, while a two-minute Convex cron brings Google-side
edits, completions, and reopening back to Cannvas. Deletions and removals never
flow from Cannvas to Google. Deleting a linked task in Google removes it from
Cannvas, and Cannvas deliberately has no delete control for to-do's. Mum and
Josh to-do's stay in Cannvas only. Google's API exposes due dates but not due
times or Cannvas priority. As a safety guard, a poll reporting more than five
linked deletions is rejected without applying that deletion batch.

Configure a Google OAuth web client whose redirect URI is:

```text
https://<deployment>.convex.site/google-tasks/callback
```

Then configure the Convex deployment:

```sh
pnpm exec convex env set GOOGLE_TASKS_CLIENT_ID '<oauth client id>'
pnpm exec convex env set GOOGLE_TASKS_CLIENT_SECRET '<oauth client secret>'
pnpm exec convex env set GOOGLE_TASKS_REDIRECT_URI 'https://<deployment>.convex.site/google-tasks/callback'
pnpm exec convex env set GOOGLE_TASKS_SETUP_TOKEN '<long random token>'
pnpm exec convex env set CANNVAS_QUICK_ADD_TOKEN '<different long random token>'
pnpm exec convex env set CANNVAS_TODO_ACCESS_TOKEN '<third long random token>'
```

Open the one-time connection URL in a signed-in browser:

```text
https://<deployment>.convex.site/google-tasks/connect?setupToken=<setup token>
```

The Apple Shortcut sends `POST /quick-add-todo` with the quick-add token as a
Bearer token and a JSON body. Omitted assignee and priority default to `dad` and
`medium`. An omitted due date defaults to tomorrow in the
`Australia/Perth` time zone, matching the existing shortcut behaviour.

Set the same `CANNVAS_TODO_ACCESS_TOKEN` value as
`VITE_CANNVAS_TODO_ACCESS_TOKEN` when building the mirror. It authorizes the
private kiosk client to read and edit canonical to-do's without exposing the
broader Google OAuth credentials.

### Google Calendar

Cannvas reads the primary calendar through its private iCal feed, so subscribed
and external calendars are never queried. Add these values before building a
calendar-enabled mirror release:

```sh
pnpm exec convex env set GOOGLE_CALENDAR_ICAL_URL '<primary secret iCal address>'
pnpm exec convex env set CALENDAR_ACCESS_TOKEN '<long random token>'
```

Set the same token as `VITE_CALENDAR_ACCESS_TOKEN` in the build environment.
The browser never receives the private iCal address. Declined and cancelled
events are omitted, and the home screen shows today plus the next seven days.

## Home Assistant

The Home controls app connects to the Home Assistant instance reachable from
the mirror. Open Home Assistant, go to the user profile, create a Long-Lived
Access Token, then enter it through **Home controls → Connect** on Cannvas.

`deploy/cannvas-server` stores the connection in
`/var/lib/cannvas/home-assistant.json` with mode `0600`. The server binds only
to loopback and proxies the small set of state and control APIs Cannvas needs,
so the Home Assistant token is never compiled into or returned to the browser.
The app discovers Person entities, common controls, climate entities, and
useful household sensors automatically.

## Raspberry Pi kiosk

Production assets live under versioned `/opt/cannvas/releases` directories.
`cannvas-web.service` runs the static server and Home Assistant proxy from the
active release on localhost, and Labwc starts
Chromium as a borderless screen-sized Wayland app after the service is reachable
and the real HDMI display is connected. This prevents Chromium from opening on
Labwc's temporary headless output when the TV is still asleep. Cannvas avoids
Chromium's true fullscreen layer because Labwc places that layer above the
on-screen keyboard.

`deploy/cannvas-display-wake` sends HDMI-CEC One Touch Play commands during
desktop startup so a CEC-enabled TV powers on and selects Cannvas. The TV's own
HDMI-CEC setting must be enabled for it to respond. On the mirror, CEC uses
`/dev/cec0` and the TV is connected to `HDMI-A-1` at physical address `1.0.0.0`.
Install the required libCEC client with `sudo apt install cec-utils`.

Every editable field uses the native `wvkbd` Wayland keyboard rather than an
in-app keyboard. A global focus and touch handler asks the loopback-only
`deploy/cannvas-keyboard` controller to show the 620-pixel-high keyboard with
large keys. Labwc starts the controller before Chromium, while the user
autostart override in `deploy/squeekboard.desktop` disables the much smaller
Squeekboard panel.

Install the native keyboard package on a new mirror with `sudo apt install wvkbd`.

### Multi-touch check

The whiteboard handles each Pointer Event ID as an independent stroke. Labwc
must pass native touch events through to Chromium, so `deploy/labwc-rc.xml`
sets `mouseEmulation="no"`. Enabling Labwc mouse emulation translates all touch
events to mouse events and collapses concurrent contacts into one pointer.

`deploy/99-touch-calibration.rules` explicitly keeps the IR frame at the
identity matrix because Labwc already maps it through the HDMI output's 90°
portrait transform. Install it under `/etc/udev/rules.d`, then restart the
graphical session or reconnect the touch USB device so libinput reopens the
frame.

On the Pi, `sudo libinput debug-events` should show a separate `TOUCH_DOWN`
event for each finger. `sudo evtest` can also confirm that the device exposes
`ABS_MT_SLOT` and `ABS_MT_TRACKING_ID`, which indicate multi-touch support.
