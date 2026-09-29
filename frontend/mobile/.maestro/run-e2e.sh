#!/usr/bin/env bash
set -eo pipefail

adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# The app pushes /offline whenever NetInfo reports no usable
# connection, and a freshly booted emulator often has not finished
# bringing its network up. Without this wait every flow fails on the
# cold-start assertion before it reaches anything it meant to test.
# The flows also dismiss the offline screen defensively, so a failure
# to validate here degrades rather than blocks.
for i in $(seq 1 30); do
  if adb shell dumpsys connectivity 2>/dev/null | grep -q "VALIDATED"; then
    echo "Emulator network validated"
    break
  fi
  echo "Waiting for emulator network ($i/30)"
  sleep 5
done

maestro test .maestro --format junit --output maestro-report.xml
