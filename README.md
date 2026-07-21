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

The mirror is local-first. Browser storage on the device is authoritative and
every interaction updates it immediately. Convex receives a revisioned snapshot
after a 500 ms debounce and acts only as backup/recovery storage; incoming
Convex updates never reconcile over an existing local snapshot. The first run
imports the previous Convex boards and chores before establishing local
authority.

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

## Raspberry Pi kiosk

Production assets live under versioned `/opt/cannvas/releases` directories.
`cannvas-web.service` serves the active release on localhost, and Labwc starts
Chromium as a borderless screen-sized Wayland app after the service is reachable
and the real HDMI display is connected. This prevents Chromium from opening on
Labwc's temporary headless output when the TV is still asleep. Cannvas avoids
Chromium's true fullscreen layer because Labwc places that layer above the
on-screen keyboard.

`deploy/cannvas-display-wake` sends HDMI-CEC One Touch Play commands during
desktop startup so a CEC-enabled TV powers on and selects Cannvas. The TV's own
HDMI-CEC setting must be enabled for it to respond. On the mirror, CEC uses
`/dev/cec0` and the TV is connected to `HDMI-A-1` at physical address `1.0.0.0`.

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
