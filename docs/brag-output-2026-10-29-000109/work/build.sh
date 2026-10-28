#!/usr/bin/env bash
# Rebuild the launch video from source: frames, music, poster, then brag.mp4.
# Needs node, ffmpeg, and Playwright's chromium_headless_shell-1248 in ~/.cache/ms-playwright.
set -euo pipefail
cd "$(dirname "$0")"
OUT=..
POSTER_FRAME=00165 # 5.5 s: logo, tagline and overview settled

rm -rf frames
node render.mjs frames 30 22.5
node synth.mjs music.wav

cp "frames/f$POSTER_FRAME.png" poster.png
ffmpeg -y -loglevel error -i poster.png -q:v 2 "$OUT/brag.jpg"
# Bake the poster in as frame 0 (replace, not insert, so duration and sync hold)
cp poster.png frames/f00000.png

ffmpeg -y -loglevel error -framerate 30 -i frames/f%05d.png -i music.wav \
  -af "loudnorm=I=-14:TP=-1.5:LRA=7" -ar 48000 \
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -t 22.5 "$OUT/brag.mp4"

echo "built $OUT/brag.mp4 and $OUT/brag.jpg"
