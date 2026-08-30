#!/bin/bash
# Regenerate the shipped icons from the full-size artwork.
#
# assets/knowitowl-source.png is 1254x1254 and 1.4MB — the source of truth, kept
# out of public/ so it is never served. Everything the browser actually loads is
# generated here and totals about 150KB.
set -euo pipefail
cd "$(dirname "$0")/.."

sips -Z 256 assets/knowitowl-source.png --out public/owl-256.png > /dev/null  # in-page logo, 2x of its 128px box
sips -Z 180 assets/knowitowl-source.png --out public/owl-180.png > /dev/null  # apple-touch-icon
sips -Z 32  assets/knowitowl-source.png --out public/owl-32.png  > /dev/null  # favicon

ls -l public/owl-*.png
