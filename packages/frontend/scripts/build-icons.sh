#!/bin/bash
# Regenerate the shipped icons from the full-size artwork.
#
# assets/knowitowl-source.png is 1254x1254 and 1.4MB — the source of truth, kept
# out of public/ so it is never served. Everything the browser actually loads is
# generated here. The two large ones are offered to the Join hero through a
# srcset, so a phone on pub wifi never downloads the 768 that only a desktop
# display can resolve.
set -euo pipefail
cd "$(dirname "$0")/.."

sips -Z 768 assets/knowitowl-source.png --out public/owl-768.png > /dev/null  # Join hero on a desktop display
sips -Z 512 assets/knowitowl-source.png --out public/owl-512.png > /dev/null  # Join hero on a phone
sips -Z 256 assets/knowitowl-source.png --out public/owl-256.png > /dev/null  # header mark, and 2x fallback
sips -Z 180 assets/knowitowl-source.png --out public/owl-180.png > /dev/null  # apple-touch-icon
sips -Z 32  assets/knowitowl-source.png --out public/owl-32.png  > /dev/null  # favicon

ls -l public/owl-*.png
