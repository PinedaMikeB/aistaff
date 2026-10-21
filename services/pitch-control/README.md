# Pitch control service

Private Bosgame-only control surface for the production AIStaff admin panel.

It can read the live Stack 4 state, save a validated allowlist of Pitch settings,
generate Piper previews from installed ONNX models, and invoke only
`scripts/restart-pitch-stack.sh`. Every route requires a bearer token and an
allowed source IP.

Required environment:

```text
PITCH_CONTROL_TOKEN=<random secret of at least 32 characters>
PITCH_CONTROL_ALLOWED_IPS=127.0.0.1,::1,192.168.254.125,::ffff:192.168.254.125
PITCH_CONTROL_HOST=0.0.0.0
PITCH_CONTROL_PORT=5198
```

The production AIStaff server uses the same token through
`PITCH_CONTROL_URL` and `PITCH_CONTROL_TOKEN`. Do not put either value in
browser JavaScript.
