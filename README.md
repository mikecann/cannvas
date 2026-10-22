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
- **Home controls:** see and control useful Home Assistant devices, including
  the robot vacuum and the filming lights, check UniFi network activity, and
  show family locations when those are available.
- **Doorbell:** pop up over any screen when someone rings the front door.
- **Voice commands:** say the wake word, then ask it to switch the lights, open
  a screen, or answer a quick question. Speech never leaves the Pi.
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
- `/inventory/` redirects to the standalone private inventory at [inventory.mikecann.app](https://inventory.mikecann.app/).
- `/giveaway/` redirects to the standalone public, read-only [Giveaway page](https://inventory.mikecann.app/giveaway/).

## Add the Convex backend

The main touchscreen can work locally, but Convex unlocks shared data, backups,
authentication, file uploads, AI enrichment, and the live integrations.

Start the Convex development setup in another terminal:

```sh
pnpm convex:dev
```

This creates the local deployment details used by the app. See
[`.env.example`](.env.example) for the browser settings you can provide.

### The touchscreen's device token

The touchscreen has no signed-in user, so every Convex call it makes carries a
shared device token. Whiteboard and chore backups, to-dos, the calendar and
the news headlines all refuse calls without it.

```sh
pnpm exec convex env set CANNVAS_DEVICE_TOKEN "$(openssl rand -hex 32)"
```

Put the same value in `.env.local` as `VITE_CANNVAS_DEVICE_TOKEN` before
building the touchscreen. Without it the touchscreen still works, but only on
local data with no backup.

The token ends up in the touchscreen's JavaScript, which is fine because that
build is only served from the Raspberry Pi. The public website is a separate
build (see below) that never contains it.

Server functions are built with [fluent-convex](https://github.com/mikecann/fluent-convex)
builders from [`convex/fluent.ts`](convex/fluent.ts): `deviceQuery`,
`deviceMutation` and `deviceAction` for the touchscreen, `inventoryQuery` and
`inventoryMutation` for signed-in inventory users, and `publicQuery` for the
few deliberately public reads.

### Inventory

The phone app and its Convex backend now live in the private
[inventory repository](https://github.com/mikecann/inventory). It uses the official
Convex Auth v2 passkey provider. Account creation alone grants no household
access. Its repo owns photos, full-text search, AI enrichment, locations and the
append-only edit and movement history.

Cannvas retains its old inventory records for rollback. Keep
`INVENTORY_READ_ONLY=1` on the Cannvas production backend after cutover so an
old client cannot keep writing to that retained copy. The source schema stays
unchanged. Do not set up new inventory password accounts in this repo.

The Giveaway page uses a separate anonymous Convex query. It only exposes active
items placed in Giveaway or To Giveaway and leaves out household locations,
history, creator details, and AI research sources.

The family touchscreen has a separate read-only Inventory view that does not
ask for a login. Its access token stays on the Pi and is never included in
the public browser bundle. When setting up a new Pi, configure it with:

```sh
# Run from the standalone inventory checkout so Convex selects its backend.
/path/to/cannvas/deploy/configure-kiosk-inventory https://hushed-meerkat-855.convex.site
```

You can pass the Pi's Tailscale hostname as a second argument when it is not
named `cannvas`.

### Google Calendar

Cannvas reads one private iCal feed. The feed address stays in Convex rather
than being sent to the browser, and the touchscreen reads it with its device
token.

```sh
pnpm exec convex env set GOOGLE_CALENDAR_ICAL_URL '<private iCal address>'
```

Declined and cancelled events are left out.

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
```

Open the connection link once while signed in to the Google account you want to
use:

```text
https://<deployment>.convex.site/google-tasks/connect?setupToken=<setup token>
```

The touchscreen uses the shared to-do list whenever it has its device token.
Google OAuth credentials remain on the server.

Sync runs every two minutes. A to-do that fails to push backs off (2 minutes
doubling up to 6 hours). If a poll hits a problem, such as Google reporting
more than five deletions of linked tasks at once, the rest still syncs and the
problem is stored as `lastPollError` on the `googleTasksConnections` row.
After checking Google, apply a large batch of deletions with:

```sh
pnpm exec convex run googleTasks:poll '{"fullSync":true,"allowDeletions":<count>}'
```

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

#### Front door, vacuum and filming lights

Home controls has a card for the Ring doorbell at the front door, one for the
Roborock vacuum, and switches for the two Elgato Key Lights.

- **Doorbell:** when `event.front_door_ding` fires, a pop-up shows over
  whatever is on screen with a big bell and the time. A tap or a minute closes
  it. The page asks the Pi every 1.5 seconds and the Pi reads just that entity
  from Home Assistant, so it shows within a couple of seconds of Home Assistant
  hearing the ring. A ring from before Cannvas started, or an old one Home
  Assistant restores after a restart, never pops up (ages are measured on Home
  Assistant's clock). The card shows the last ring and a warning under 20%
  battery. Ring only gives Home Assistant pictures with a Ring Protect plan,
  which we don't have, so the card and pop-up only show the front door
  picture (through `/api/doorbell/snapshot`) if one actually loads.
- **Vacuum:** its state (with the error when it has one), battery, the map
  through `/api/vacuum/map` zoomed to the house, Full clean (which also
  resumes a paused clean), Living room & kitchen, Pause and Return to dock,
  and any brush, filter or sensor with 10 hours or less left. The Pi server
  allows only `vacuum.start`, `vacuum.pause`, `vacuum.return_to_base` and
  `vacuum.clean_area`, and only for `vacuum.roborock_q7_max`. For a room
  clean the page sends a preset name and the Pi turns it into Home Assistant
  area ids (`living_room_kitchen` is `living_room` and `kitchen`), so the page
  can't choose other areas. Room cleans need the Roborock map to have rooms
  matched to those Home Assistant areas. Until then Home Assistant refuses
  them and the card says the vacuum doesn't know its rooms yet.
- **Filming lights:** while either Key Light is on, the home screen says
  "Dad's filming" under the clock.

The Pi only passes on pictures Home Assistant labels as JPEG, PNG, WebP or GIF.

#### Trying it without Home Assistant

`deploy/mock-home-assistant` is a pretend Home Assistant for a laptop. It has
made-up states for these devices and switches nothing real, and deploys never
ship it. Run it next to a local `cannvas-server`:

```sh
pnpm build
deploy/mock-home-assistant &
echo '{"url": "http://127.0.0.1:8124", "token": "mock-token-0000000000"}' > tmp/mock-ha.json
CANNVAS_WEB_ROOT=dist CANNVAS_HOME_ASSISTANT_CONFIG=tmp/mock-ha.json \
  CANNVAS_HEARTBEAT_PATH=tmp/heartbeat python3 deploy/cannvas-server
```

Open [http://localhost:4173](http://localhost:4173), then
`curl -X POST localhost:8124/mock/ding` rings the doorbell. See the top of the
script for changing any state, a camera with no picture, and room cleans.

### Chef (feature requests and cloud builds)

More > **Suggest a feature** opens [Chef](https://github.com/convex/chef-cloud)'s
request sheet, Seth Raphael's feedback board with cloud builds (private and
pre-release). Anyone at the wall can type a request, or send a screenshot of
the screen they're on with a voice note, and see how their requests are
getting on. There's no floating button. Mike approves requests from his email,
with no sign-in.

Approved requests queue up (Chef's `requested` state, "Planned" on the wall)
and get built by hand, the same as Walkies: when Mike's at his desk he asks
his agent to do the Cannvas feature list, which builds each one, deploys it and
marks it done. Cloud builds are set up on prod but stay off. Mike chose the
queue over Chef building in the cloud by itself.

- **Read the queue:** `npx convex data items --component feedback --prod
  --format jsonLines`. Screenshots and voice notes:
  `npx convex run --component feedback attachments:list
  '{"itemId":"<id>","viewer":"cannvas-wall"}' --prod` returns signed URLs.
- **Mark one done:** `items:setChangelog '{"itemId":"<id>","text":"..."}'`,
  then `items:transitionState '{"itemId":"<id>","state":"completed"}'`, both
  with `--component feedback --prod`. The changelog is a plain sentence or two
  the family will read on the wall.

- **Packages:** `@convex-dev/feedback` and `@convex-dev/chef-cloud` are vendored
  in `vendor/` from the same commit of `convex/chef-cloud` (`7054e5a`), because
  Chef's build sandboxes can only install from the npm registry. To update,
  pack both again from one commit and `pnpm install`.
- **Who's who:** the wall has no user, but Chef only takes requests from
  someone it can name. So the wall is one Chef member, `cannvas-wall`: the sheet
  trades the device token for an hour-long Convex auth token with that subject
  (`chefWall:token`, signed with Convex Auth's `JWT_PRIVATE_KEY`). Mike is the
  admin, `mike`. No caller can ever be `mike`: `getUserId` in
  [`convex/chef.ts`](convex/chef.ts) only answers `cannvas-wall` or null.
- **Emails:** every request waiting for approval is emailed to
  mike.cann@gmail.com with **Approve** and **Reject**. Chef's own
  emails (a build is ready or failed, a release shipped or didn't) go there
  too, and "ready" gets a **Ship it** button. Each button opens
  `https://<deployment>.convex.site/chef/link?t=<token>`: a random token, stored
  only as its SHA-256, for one request (or build) and one action, single use
  and good for 7 days. The GET only shows what it would do. Pressing the
  page's button POSTs, and that acts, as `mike`, through the feedback
  component ([`convex/chefLinks.ts`](convex/chefLinks.ts)). Gmail and link
  scanners only ever GET. A request's links ran out, or the email never
  came? `npx convex run chefMail:sendRequestEmail '{"itemId":"<id>"}'`
  (`--prod`) sends a new email, with new links, while it's still waiting.
  Links from earlier emails keep working until any one of that request's
  links is used, which retires the rest.
- **No admin panel:** nobody signs in to Chef as `mike`, so Chef's own admin
  panel (watching builds, Try again, the run log) isn't anywhere. The emails
  are the admin surface, and `npx chef status` and `npx convex run chef:...`
  the rest.
- **Sending:** through Chef's bundled Resend in gateway mode, with the
  deployment's own service token, billed to the Convex team. The sender is
  `Cannvas <chef@mail.mikecann.app>` (`CHEF_EMAIL_FROM` overrides it), and
  `mail.mikecann.app` has to be a sending domain the team verified through the
  gateway ([`docs/runbooks/chef-prod.md`](docs/runbooks/chef-prod.md), step 1).
  Until it is, sends fail with `domain_not_verified` and nothing else breaks.
- **Cloud builds:** Chef's repo for the app is `cannvas` on Code Storage (the
  `chef` git remote). A build previews the wall's Vite build from static
  hosting on a preview deployment. A sandbox has no device token, so a preview
  shows the wall on its sample data and has no Suggest a feature.
- **Ship it** deploys the backend to the deployment `CHEF_DEPLOY_KEY` is for,
  publishes the same token-less frontend to that deployment's static hosting
  (not the wall), and moves main in Chef's repo. The wall only changes when
  you run `deploy/ship-from-chef.sh`: it fast-forwards main to Chef's, pushes
  it to GitHub and runs `deploy/deploy.sh`. It refuses if GitHub's main or
  your checkout has commits Chef's main doesn't, so it only ever deploys what
  Chef shipped. Until it runs, the wall runs the old frontend against the new
  backend.
- **Chef follows GitHub:** after every production deploy, the workflow runs
  `deploy/chef-follow-github.sh`, which fast-forwards Chef's main to the
  commit it deployed (`chef sync --prod`, never forced), so builds start from
  what's live. It does nothing while Chef isn't set up on prod. If main moves
  while a build waits for Ship it, Chef doesn't ship the stale base: it
  merges the new main into the build, re-runs its checks, and ships the
  merge on the same approval when the change is the same. A merge that
  needs a person (a conflict it resolved or couldn't) waits for an approval
  in Chef's admin panel, which Cannvas doesn't have yet (see below).
  Dev's Chef main doesn't follow anything: `npx chef sync` by hand.
- **Deploy guard:** `pnpm convex:dev`, `pnpm convex:deploy` and the production
  workflow run `chef guard` first, which refuses to deploy a checkout that
  lacks what Chef shipped. `git pull chef main` (or `deploy/ship-from-chef.sh`)
  fixes it.

`npx chef status` (`--prod` for production) shows the setup, by name only.

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

The kiosk uses `deploy/cannvas-kiosk.service` and
`deploy/cannvas-keyboard.service` as persistent **user** units in
`~/.config/systemd/user/`. Labwc's autostart imports its current Wayland socket
and restarts both units on login; systemd restarts them if they exit. Managing
the keyboard and its child together prevents an old controller from retaining
the previous desktop socket or blocking the new controller's port.

Install `deploy/cannvas-display-recover` in `/usr/local/sbin/` and its matching
service and timer in `/etc/systemd/system/`, then enable the timer. It checks
for an active Pi Wayland desktop every 30 seconds and restarts LightDM after
two failed checks. This recovers the login screen left behind when a desktop
exits. Stop `cannvas-display-recover.timer` before intentional console or login
screen maintenance, and start it again afterwards. Use graphical autologin
only; remove the separate `getty@tty1.service.d/autologin.conf` override to
avoid a second automatic seat session during boot.

The September 2026 login-screen incident was a desktop failure, not rejected
credentials: LightDM logged `pi` in successfully, Labwc logged DRM permission
errors and exited with status 1, then LightDM left the greeter active. The exact
trigger for the display permission loss was not established. Recovery should
not depend on that trigger: killing Chromium must restart its user service,
and terminating Pi's Labwc must restore the desktop through the timer. A full
reboot should start the desktop, browser, keyboard and timer without a login.

### Deploying

`deploy/deploy.sh` builds the app and ships it to the Pi (Tailscale host
`cannvas`):

```sh
deploy/deploy.sh            # build, upload, switch, health check
deploy/deploy.sh rollback   # switch back to the previous release
```

Each release lives in `/opt/cannvas/releases/<YYYYmmdd-HHMMSS>-<sha>`, owned by
root, with the web build in `www/` and `cannvas-server` beside it. The server
only serves `www/`, so the script and anything else in the release stay
private. The deploy switches `/opt/cannvas/current` with an atomic rename,
restarts `cannvas-web` and the kiosk, and checks that `/` and `/api/health`
answer. `/api/health` only checks the server, so a Home Assistant outage can't
block a deploy. If either check fails, it switches back on its own. It keeps the newest five
releases plus the previous one.

Set `CANNVAS_HOST`, `CANNVAS_BUILD`, `CANNVAS_DIST` or `CANNVAS_SKIP_BUILD=1`
to change the host, build command, build output directory, or to reuse an
existing build. The build reads the kiosk's `VITE_*` tokens from the untracked
`.env.local`.

The server has Python tests (3.11 or newer). `pnpm test` runs them after the
Node tests, and so does CI. To run them on their own:

```sh
pnpm test:server
```

### Installing the system pieces

The deploy script only ships the app. The units and helper scripts are
installed once:

```sh
# Web server and the power-off helper it may start through polkit
sudo install -m 0644 deploy/cannvas-web.service deploy/cannvas-poweroff.service \
  deploy/cannvas-ha-shutdown.service /etc/systemd/system/
sudo install -m 0644 deploy/50-cannvas-poweroff.rules /etc/polkit-1/rules.d/
sudo install -m 0755 deploy/cannvas-ha-shutdown /usr/local/bin/

# Kiosk watchdog (a user timer, like the kiosk itself)
sudo install -m 0755 deploy/cannvas-kiosk-watchdog /usr/local/bin/
install -m 0644 deploy/cannvas-kiosk-watchdog.service \
  deploy/cannvas-kiosk-watchdog.timer ~/.config/systemd/user/

# Smaller journal on the SD card
sudo install -D -m 0644 deploy/journald-cannvas.conf \
  /etc/systemd/journald.conf.d/cannvas.conf

sudo systemctl daemon-reload
sudo systemctl restart systemd-journald
sudo systemctl enable --now cannvas-web.service cannvas-ha-shutdown.service
systemctl --user daemon-reload
systemctl --user enable --now cannvas-kiosk-watchdog.timer
```

`cannvas-web.service` runs as `pi` with no capabilities, no devices, a
read-only system, and a 256M memory cap. It can write only
`/var/lib/cannvas` (integration settings) and `/run/cannvas` (the kiosk
heartbeat). The 30 second display recovery check and the kiosk watchdog use
`LogLevelMax=notice`, so they only log when they act.

### Sleep time power off

Home Assistant switches the smart plug feeding the TV and Pi off when someone
taps Sleep time on the home screen or Turn off Cannvas in the More menu, and
back on at 06:00. There's no fixed off time, so Cannvas stays on for anyone
up late. (A "Turn off Cannvas at midnight" automation is still in Home
Assistant, switched off, if that's ever wanted again.) Cutting power to a
running Pi risks the SD card, so the Pi shuts itself down first, through the
`script.cannvas_power_off` script in Home Assistant:

1. Sleep time runs `script.sleep_time`, which turns off
   `light.living_room_lights` and then runs `script.cannvas_power_off`. Turn
   off Cannvas runs `script.cannvas_power_off` on its own, and if Home
   Assistant can't be reached it falls back to `/api/system/poweroff`, which
   shuts down only the Pi. The script turns on
   `input_boolean.cannvas_shutdown`.
2. `cannvas-ha-shutdown.service` on the Pi polls that helper every 10 seconds,
   using the Home Assistant token the web server already stores. When it sees
   the helper on, it starts `cannvas-poweroff.service`, the same
   polkit-approved helper the on-screen power button uses, then turns the
   helper back off as an acknowledgement. If the power-off can't start, it
   leaves the helper on and tries again on the next poll.
3. The script waits up to 60 seconds for that acknowledgement, then 60
   seconds more for the Pi to halt, then cuts the plug and clears the helper.

If the Pi never answers, the plug still goes off after two minutes, as before.
The Pi only makes outgoing requests, so nothing new listens on the network. It
ignores a request more than ten minutes old (measured on Home Assistant's
clock, because the Pi has no real-time clock), and the 06:00 automation clears
the helper before switching the plug on, so a leftover request cannot switch the
display straight back off in the morning. The plug's power sensor can't show
when the Pi has halted because the TV draws most of the power, which is why the
script uses a fixed wait.

### Evening buttons

From an hour before sunset, when Home Assistant turns the living room lights
on, until sunrise, the home screen shows Lights on, Lights off and Sleep time.
The lights buttons switch the `light.living_room_lights` group, so a new lamp
only needs adding to that group in Home Assistant. The home screen reads that
one entity through `/api/home-assistant/entity` rather than every state in the
house. Sleep time asks first, then runs `script.sleep_time`.

### Evening dimming

There's no light sensor, so the screen follows the sun. It starts dimming at
sunset, reaches about 45% brightness at 21:00 and stays there until sunrise.
Any touch brings full brightness back for three minutes. Sunrise and sunset
come from Home Assistant's `sun.sun` through `/api/sun`, with a local
calculation for Busselton when Home Assistant can't be reached.

### Voice commands

A USB microphone on the Pi lets the family talk to Cannvas: "Hey Canvas,
lights off", "Hey Canvas, open the calendar", or just a question. Listening,
speech recognition, everyday commands and the spoken replies all run on the
Pi:

1. `cannvas-voice` listens for "Hey Canvas" with
   [openWakeWord](https://github.com/dscripka/openWakeWord) and plays a chime.
   The model was trained for this project (see `deploy/wake-word/`).
2. It records until you stop talking (Silero VAD), then turns that into text
   with NVIDIA's Parakeet Unified EN 0.6B (int8) through
   [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). In our recordings it
   handled speech across the room better than Moonshine, taking about 0.56
   seconds on the Pi. Older installs use Moonshine until the Parakeet model
   is installed with `deploy/install-voice`. To switch back, set
   `CANNVAS_SPEECH_MODEL=/opt/cannvas-voice/models/moonshine-base-en` in the
   voice service's environment and restart it.
3. Everyday commands ("lights off", "turn on the TV lamp", "set the top lamp
   to 30 percent", "open the calendar") are matched straight away. Anything
   else goes to OpenAI's GPT-6 Luna through [OpenRouter](https://openrouter.ai),
   which either picks a tool or answers in a sentence. Without a key or
   without internet, Qwen3 1.7B in `llama-server` (`cannvas-llm.service`)
   answers instead, in 3 to 10 seconds on the Pi.
4. [Piper](https://github.com/OHF-Voice/piper1-gpl) speaks the reply through
   the TV, and the screen shows what it heard and what it said.

Quiet wake phrases get a second chance. With Parakeet installed, an utterance
whose best wake score is between 0.05 and the normal 0.5 threshold is checked
by the same speech model. If its transcript starts with "Hey Canvas" or
"Canvas" (also "Cannvas"), the remaining words become the request and the end
chime acknowledges it. Just the wake phrase plays the usual start chime and
listens for the command. A normal wake still chimes straight away.
Set `CANNVAS_WAKE_SECOND_CHANCE=0` in the voice service's environment to turn
this off, or set it to a different lower threshold. Older Moonshine installs
leave it off by default. Our nine recorded tries improved from 5 to 7 wakes;
two far-side tries still weren't recognised. Two hours of far-field speech
guards added no false wakes and needed about 3.5 speech checks per hour.

Audio stays in a short memory buffer while the Pi checks an utterance, then is
discarded. It never leaves the Pi. Rejected second-chance checks log only the
wake score, with no transcript or screen event. Only accepted requests reach
the command handler; the text of one that isn't an everyday command goes to
OpenRouter.

Voice can switch every Home Assistant light. Other switches need a spoken name
in `/var/lib/cannvas/voice.json`, for example
`{"devices": {"switch.athom_outside_lights_smart_plug_v2": "Outside Lights"}}`.
The plug that powers the TV and the Pi can never be a voice device.

The page follows along through `/api/voice/events`, which `cannvas-server`
relays from the voice service's loopback port, so the browser still only
talks to its own server. After a reply, the mic button on the card listens
again without the wake word.

**More → Admin → Wake word training** records the family saying "Hey Canvas"
around the room, to train the wake word on. Pick who is talking, roughly where
they are, and whether they'll say the wake word or something else, then start
recording. While it records, voice commands act on nothing: each utterance is
scored with the live model, shown large enough to read from across the room
("Would wake" or "Wouldn't wake"), and saved with its score and transcript in
`/var/lib/cannvas/voice-samples` on the Pi, readable only by `pi`. Recording
stops when you leave the page, and after 20 minutes regardless. Copy the clips
off with `scp -r cannvas:/var/lib/cannvas/voice-samples .` and see
`deploy/wake-word/training/README.md` for retraining.

Set it up once with:

```sh
deploy/install-voice
```

It builds `llama-server` from a pinned llama.cpp release, installs the
Python packages from `deploy/voice-requirements.txt` and the models into
`/opt/cannvas-voice`, and enables both services. It also installs the kiosk's
audio setup, which stops the TV's HDMI sink from going to sleep between
sounds. Waking it again let the TV drop the first quarter of a second, which
clipped the chime and the start of each reply. `deploy/deploy.sh` ships
`cannvas-voice` with each release and restarts it. Follow it with
`journalctl --user -u cannvas-voice -f` on the Pi.

Give it an [OpenRouter API key](https://openrouter.ai/settings/keys) with:

```sh
deploy/configure-openrouter
```

It asks for the key without showing it, checks it with OpenRouter, and stores
it in `/var/lib/cannvas/openrouter.json` on the Pi, readable only by `pi`.

### Kiosk watchdog

The page POSTs to `/api/heartbeat` every 30 seconds from the app shell, so
the pings stop if React stops rendering. The server records the time in `/run/cannvas/heartbeat`, and the
`cannvas-kiosk-watchdog` user timer restarts `cannvas-kiosk.service` if no ping
has arrived for three minutes. It does nothing until the first ping after boot,
skips a kiosk that started in the last three minutes or a web server that is
down, and restarts only once per silence, so a page that never pings can't
cause a restart loop.

## How the data is handled

Whiteboards, chores, pet schedules, and device settings work locally on the
touchscreen. When Convex is connected, Cannvas keeps a revisioned backup so the
display can recover without making the internet connection responsible for
every tap or brush stroke. Each whiteboard date is its own backup document, so
the backup can't outgrow Convex's document size limit. If backing up fails, the
screen shows a "Backup paused" badge and keeps retrying. Nothing is lost from
the screen itself.

Inventory photos are redrawn as JPEGs in the browser before upload, which
removes EXIF data such as GPS location. Photos uploaded before that change
still have theirs.

Inventory, Google Tasks, and Calendar use the Convex backend. Home Assistant and
UniFi stay behind the local Raspberry Pi server. Their private credentials are
not committed to this repository.

## Useful commands

```sh
pnpm dev                # Run the app locally
pnpm typecheck          # Check the TypeScript code
pnpm test               # Run the regression tests
pnpm build              # Build the touchscreen into dist/ (never publish this)
pnpm build:mirror       # Build the touchscreen against the production backend
pnpm build:public       # Build the public website into dist-public/
pnpm preview            # Preview the touchscreen build
pnpm convex:dev         # Run or configure the Convex development backend
deploy/ship-from-chef.sh  # Put what Chef shipped on the wall
pnpm deploy:cloudflare  # Publish dist-public/ to Cloudflare
```

There are two separate builds. The touchscreen build (`dist/`) carries the
device token and is only ever copied to the Raspberry Pi. The public website
(`dist-public/`) only has the app launcher, `/inventory/` and `/giveaway/`,
and its build fails if any touchscreen code or token value would end up in it.
GitHub Actions deploys Convex and the public website on every push to `main`.
The touchscreen is deployed by hand.

This is a real family project, so some names, labels, defaults, and integrations
are specific to our household. Fork it, swap those pieces out, and make it fit
the way your own home works.
