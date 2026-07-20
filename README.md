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
Chromium in Wayland kiosk mode after the service is reachable.

Chore text fields use the system Squeekboard keyboard rather than an in-app
keyboard. The mirror's larger touch layout lives at
`~/.local/share/squeekboard/keyboards/us.yaml` and `us_wide.yaml`; both use the
tracked source `deploy/squeekboard-us.yaml`. The rotated display currently asks
Squeekboard for the wide layout name even though it is portrait on the wall.

### Multi-touch check

The whiteboard handles concurrent pointer contacts, and the kiosk launcher does
not disable touch input. On the Pi, `sudo libinput debug-events` should show a
separate `TOUCH_DOWN` event for each finger. If it reports only one contact,
check the display's USB touch cable and driver; HDMI carries the picture but
usually not touch input. `sudo evtest` can also confirm that the device exposes
`ABS_MT_SLOT` and `ABS_MT_TRACKING_ID`, which indicate multi-touch support.
