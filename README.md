# Cannvas

Cannvas is a touch-first family dashboard designed for a shared TV display.

The plan is to bring everyday household tools into one place, including a
digital whiteboard, chores and pocket money, news, weather, and more.

## Apps

- Daily vector whiteboards with date history and Convex persistence
- Joshua's weekly chore tracker and pocket-money totals
- An idle home display using the original Mike's Smarter Mirror family-video
  library and Yr Busselton meteogram

The interface is designed for the Pi's 1080x1920 portrait touchscreen. It
returns to the home display after five minutes without pointer or keyboard
activity.

## Development

```sh
pnpm install
pnpm convex:dev
pnpm dev
```

If `VITE_CONVEX_URL` is missing, Cannvas uses browser local storage and labels
the dock `Local`. This is useful for UI work, but the Pi release must show
`Synced`.

## Raspberry Pi kiosk

Production assets live under versioned `/opt/cannvas/releases` directories.
`cannvas-web.service` serves the active release on localhost, and Labwc starts
Chromium in Wayland kiosk mode after the service is reachable and the real HDMI
display is connected. This prevents Chromium from opening on Labwc's temporary
headless output when the TV is still asleep.

`deploy/cannvas-display-wake` sends HDMI-CEC One Touch Play commands during
desktop startup so a CEC-enabled TV powers on and selects Cannvas. The TV's own
HDMI-CEC setting must be enabled for it to respond. On the mirror, CEC uses
`/dev/cec0` and the TV is connected to `HDMI-A-1` at physical address `1.0.0.0`.

Chore text fields use the native `wvkbd` Wayland keyboard rather than an in-app
keyboard. `deploy/cannvas-keyboard` runs a loopback-only show/hide controller and
starts a 620-pixel-high keyboard with large keys. Labwc starts the controller
before Chromium, while the user autostart override in `deploy/squeekboard.desktop`
disables the much smaller Squeekboard panel.

Install the native keyboard package on a new mirror with `sudo apt install wvkbd`.

### Multi-touch check

The whiteboard handles each Pointer Event ID as an independent stroke. Labwc
must pass native touch events through to Chromium, so `deploy/labwc-rc.xml`
sets `mouseEmulation="no"`. Enabling Labwc mouse emulation translates all touch
events to mouse events and collapses concurrent contacts into one pointer.

`deploy/99-touch-calibration.rules` contains the mirror's fitted portrait
libinput matrix. Install it under `/etc/udev/rules.d`, then restart the graphical
session or reconnect the touch USB device so libinput reopens the frame.

On the Pi, `sudo libinput debug-events` should show a separate `TOUCH_DOWN`
event for each finger. `sudo evtest` can also confirm that the device exposes
`ABS_MT_SLOT` and `ABS_MT_TRACKING_ID`, which indicate multi-touch support.
