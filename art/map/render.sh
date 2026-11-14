#!/usr/bin/env bash
# Rebuild the Eden mockup and write 1x / 4x previews (nearest-neighbour, no smoothing).
#   bash art/map/render.sh
set -euo pipefail
ASE="${ASEPRITE_PATH:-D:/Games/Steam/steamapps/common/Aseprite/Aseprite.exe}"
DIR="$(cd "$(dirname "$0")" && pwd)"
"$ASE" --batch --script "$DIR/eden-mockup.lua"
"$ASE" --batch "$DIR/eden-mockup.aseprite" --save-as "$DIR/eden-mockup.png"
"$ASE" --batch "$DIR/eden-mockup.aseprite" --scale 4 --save-as "$DIR/eden-mockup-4x.png"
# Numbered preview copies: image viewers cache by path, so each review gets a fresh name.
mkdir -p "$DIR/previews"
N=$(( $(ls "$DIR/previews" 2>/dev/null | wc -l) + 1 ))
cp "$DIR/eden-mockup-4x.png" "$DIR/previews/v$N.png"
echo "wrote $DIR/eden-mockup.png, eden-mockup-4x.png and previews/v$N.png"
