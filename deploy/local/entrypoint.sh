#!/bin/sh
set -eu
umask 077
mkdir -p "$HOME/workspace" "$HOME/.local/share/keyrings" "$HOME/.config/oryh-container"
# A private, persistent Linux Secret Service replaces the desktop OS keychain.
# This single-user development container trusts its own UID, including native Bash tools.
keyring_password="$HOME/.config/oryh-container/keyring-password"
if [ ! -f "$keyring_password" ]; then
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > "$keyring_password"
fi
chmod 600 "$keyring_password"
eval "$(gnome-keyring-daemon --unlock --components=secrets < "$keyring_password")"
export GNOME_KEYRING_CONTROL
# Fail before opening the UI if credentials cannot be stored or survive a restart.
node --input-type=module <<'JS'
import { createRequire } from 'node:module'
import { existsSync, writeFileSync } from 'node:fs'
const require = createRequire('/opt/oryh-ai-client/packages/core/package.json')
const { Entry } = require('@napi-rs/keyring')
const marker = `${process.env.HOME}/.config/oryh-container/keyring-verified`
const entry = new Entry('ORYH Compose readiness', 'persistence-probe')
if (existsSync(marker) && entry.getPassword() !== 'ready') throw new Error('Linux credential store did not survive restart')
entry.setPassword('ready')
if (entry.getPassword() !== 'ready') throw new Error('Linux credential store is unavailable')
writeFileSync(marker, 'ready', { mode: 0o600 })
console.log('Linux credential store ready (persistence checked).')
JS
node scripts/install-profile.mjs
# DSH remains loopback-only. Docker publishes this TCP forwarder on host loopback only;
# it preserves Host/Origin/Cookie and does not implement or bypass authentication.
socat TCP-LISTEN:4173,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:4174 &
exec pnpm exec dsh --profile oryh-web --host 127.0.0.1 --port 4174 --no-open --trusted-host 127.0.0.1:4180 localhost:4180
