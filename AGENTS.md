# Repository Instructions

- After making user-visible UI changes, run the app and capture one or two relevant screenshots. Include the screenshots in the final response so the user can review the result.
- Capture screenshots at the target screen's actual aspect ratio and orientation so they represent the deployed display accurately. Use portrait captures for portrait screens and landscape captures for landscape screens; do not substitute a generic desktop viewport.
- After completing and verifying any requested change, commit all intended changes and push the current branch to its remote. Report the branch and commit in the final response.
- After pushing a completed change, deploy it to the mirror device and verify the live result so the user can try it immediately. Skip device deployment only when the user explicitly asks not to deploy or when access is blocked; report any blocker clearly.
- Access the display through Tailscale SSH as `pi@mirror`, using `/Applications/Tailscale.app/Contents/MacOS/Tailscale ssh pi@mirror` on this Mac. Do not assume the LAN host `raspberrypi` is the mirror.
- Deploy production builds into a new versioned directory under `/opt/cannvas/releases`, atomically update `/opt/cannvas/current`, restart `cannvas-web.service`, and restart the Chromium kiosk so the new client loads. Keep the previous release available for rollback.
- Do not capture screenshots for changes that have no visual effect, such as documentation, repository instructions, or build configuration, unless the user specifically requests them.
