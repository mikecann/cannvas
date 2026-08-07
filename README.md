[![I built my family a giant touchscreen](https://thumbs.video-to-markdown.com/831ab81c.jpg)](https://youtu.be/ubRYvl4gfGE)

# Cannvas

Cannvas turns a TV into a giant family touchscreen. It gives us one shared
place for whiteboards, chores, to-do lists, the family calendar, home controls,
weather, news, pet care, family photos, and a household inventory.

This is a [Convex](https://www.convex.dev/)-powered project. Convex handles the
shared data, backups, authentication, file storage, scheduled jobs, and
server-side integrations while the touchscreen stays responsive and useful on
the local network.

Cannvas is built around a Raspberry Pi connected to a portrait TV with an
infrared touch frame, but you can run the app in an ordinary browser to explore
it or adapt it for your own home.

## What it does

- **Whiteboards:** draw on a board for any day and return to earlier boards.
- **Chores and pocket money:** track Joshua's weekly chores, standard and bonus
  jobs, and his Spend, Grow, and Give totals.
- **Family to-do lists:** keep separate lists for Mum, Dad, and Josh, with an
  optional Google Tasks connection for Dad's list.
- **Calendar:** show today, the next week, and a full monthly view from a private
  Google Calendar feed.
- **Home controls:** see and control useful Home Assistant devices, check UniFi
  network activity, and show family locations when those are available.
- **Pet care:** keep track of Sammy's regular tablets and when each one was last
  given.
- **Household inventory:** photograph an item on your phone, record where it is,
  and let AI help identify and describe it.
- **Giveaway page:** share a deliberately small public view of things that are
  ready for friends and family to take.
- **Home display:** return automatically to family videos, weather, news, and
  upcoming events after five minutes without activity.

## Try it locally

You only need [Node.js](https://nodejs.org/) and
[pnpm](https://pnpm.io/installation).

```sh
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). Cannvas will use sample
content and store your changes in that browser, so you do not need to create an
account or configure a backend just to try the wall display.

The project has separate web experiences for different jobs:

- `/` is the portrait family touchscreen.
- `/inventory/` is the private, phone-first inventory app.
- `/giveaway/` is the public, read-only giveaway page.

## Add the Convex backend

The main touchscreen can work locally, but Convex unlocks shared data, backups,
authentication, file uploads, AI enrichment, and the live integrations.

Start the Convex development setup in another terminal:

```sh
pnpm convex:dev
```

This creates the local deployment details used by the app. See
[`.env.example`](.env.example) for the browser settings you can provide.

### Inventory

The inventory app uploads photos to Convex file storage and keeps an append-only
history of edits, moves, added photos, AI enrichment, and removal states. Its
search covers item details and the current storage location.

Add the development secret before using it:

```sh
pnpm exec convex env set OPENAI_API_KEY '<OpenAI API key>'
npx @convex-dev/auth --skip-git-check --web-server-url http://localhost:5173/inventory/
```

Create the account through `/inventory/`, then grant it access by email:

```sh
pnpm exec convex run inventoryAccessStore:grantByEmail '{"email":"you@example.com"}'
```

The first granted account becomes the owner. Other accounts cannot see or
change inventory data until they are granted access the same way.

The Giveaway page uses a separate anonymous Convex query. It only exposes active
items placed in Giveaway or To Giveaway and leaves out household locations,
history, creator details, and AI research sources.

The family touchscreen has a separate read-only Inventory view that does not
ask for a login. Its access token stays on the mirror and is never included in
the public browser bundle. When setting up a new mirror, configure it with:

```sh
./deploy/configure-kiosk-inventory https://your-deployment.convex.site
```

You can pass the mirror's Tailscale hostname as a second argument when it is not
named `mirror`.

### Google Calendar

Cannvas reads one private iCal feed. The feed address stays in Convex rather
than being sent to the browser.

```sh
pnpm exec convex env set GOOGLE_CALENDAR_ICAL_URL '<private iCal address>'
pnpm exec convex env set CALENDAR_ACCESS_TOKEN '<long random token>'
```

Add the same access token to the build environment as
`VITE_CALENDAR_ACCESS_TOKEN`. Declined and cancelled events are left out.

<details>
<summary><strong>Google Tasks setup</strong></summary>

Cannvas can keep Dad's to-do list in sync with the existing Google Tasks list
named `Personal`. Mum and Josh's lists stay in Cannvas.

Create a Google OAuth web client with this callback address:

```text
https://<deployment>.convex.site/google-tasks/callback
```

Then add the connection settings to Convex:

```sh
pnpm exec convex env set GOOGLE_TASKS_CLIENT_ID '<OAuth client ID>'
pnpm exec convex env set GOOGLE_TASKS_CLIENT_SECRET '<OAuth client secret>'
pnpm exec convex env set GOOGLE_TASKS_REDIRECT_URI 'https://<deployment>.convex.site/google-tasks/callback'
pnpm exec convex env set GOOGLE_TASKS_SETUP_TOKEN '<long random token>'
pnpm exec convex env set CANNVAS_QUICK_ADD_TOKEN '<different long random token>'
pnpm exec convex env set CANNVAS_TODO_ACCESS_TOKEN '<third long random token>'
```

Open the connection link once while signed in to the Google account you want to
use:

```text
https://<deployment>.convex.site/google-tasks/connect?setupToken=<setup token>
```

Add `CANNVAS_TODO_ACCESS_TOKEN` to the touchscreen build as
`VITE_CANNVAS_TODO_ACCESS_TOKEN`. Google OAuth credentials remain on the
server.

The `/quick-add-todo` endpoint can also accept a Bearer token from an Apple
Shortcut. If the shortcut leaves out the person, priority, or date, Cannvas
uses Dad, medium priority, and tomorrow in the `Australia/Perth` time zone.

</details>

### Home Assistant

Open **Home controls → Connect** in Cannvas and enter the address of your Home
Assistant server plus a Long-Lived Access Token.

On the Raspberry Pi, `deploy/cannvas-server` stores that connection in
`/var/lib/cannvas/home-assistant.json`, readable only by the Cannvas service.
The browser talks to this small local server and never receives the Home
Assistant token.

## Running it as a wall display

The files in [`deploy/`](deploy/) cover the Raspberry Pi kiosk used by the real
Cannvas display. They:

- start the app and Chromium automatically;
- rotate the TV into its 1080x1920 portrait layout;
- wake the TV over HDMI-CEC;
- open a large on-screen keyboard for editable fields; and
- preserve native multi-touch drawing on the whiteboard.

The deployment is tailored to our Pi, TV, and infrared touch frame, so treat it
as a working example rather than a one-click installer. At minimum, the Pi needs
the CEC and on-screen keyboard packages:

```sh
sudo apt install cec-utils wvkbd
```

For touch troubleshooting, `sudo libinput debug-events` should report a
separate `TOUCH_DOWN` event for each finger. If every finger behaves like one
mouse pointer, check the Labwc configuration in
[`deploy/labwc-rc.xml`](deploy/labwc-rc.xml).

## How the data is handled

Whiteboards, chores, pet schedules, and device settings work locally on the
touchscreen. When Convex is connected, Cannvas keeps a revisioned backup so the
display can recover without making the internet connection responsible for
every tap or brush stroke.

Inventory, Google Tasks, and Calendar use the Convex backend. Home Assistant and
UniFi stay behind the local Raspberry Pi server. Their private credentials are
not committed to this repository.

## Useful commands

```sh
pnpm dev                # Run the app locally
pnpm typecheck          # Check the TypeScript code
pnpm build              # Create a production build
pnpm preview            # Preview the production build
pnpm convex:dev         # Run or configure the Convex development backend
pnpm deploy:cloudflare  # Publish the web entries to Cloudflare
```

This is a real family project, so some names, labels, defaults, and integrations
are specific to our household. Fork it, swap those pieces out, and make it fit
the way your own home works.
