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
Chromium as a borderless screen-sized app after the service is reachable. The
Pi uses Squeekboard in automatic mode for touch input. Cannvas deliberately
avoids Chromium's true kiosk/fullscreen layer because Labwc places that layer
above the on-screen keyboard.
