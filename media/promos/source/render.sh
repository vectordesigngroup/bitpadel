set -e
for c in Mission Kit Cta; do for a in 16x9 9x16; do
  npx remotion render src/index.tsx $c-$a /workspace/bp-raw/$c-$a.mp4 --codec h264 --crf 20 --audio-codec aac --audio-bitrate 192k --concurrency=6 --browser-executable=/usr/bin/google-chrome --log=error
  echo DONE $c-$a
done; done
echo ALLDONE
