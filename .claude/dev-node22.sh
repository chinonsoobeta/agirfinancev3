#!/bin/bash
# Launch the dev server on Node 22+, which the Supabase realtime client requires
# (Node 20 lacks native WebSocket). package.json engines: node >=22 <25.
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null 2>&1
cd "$(dirname "$0")/.." || exit 1
exec npm run dev
