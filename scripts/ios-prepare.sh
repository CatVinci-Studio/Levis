#!/bin/sh
# Adds what the generated iOS project (src-tauri/gen/apple, made by
# `tauri ios init` and not committed) does not get from tauri.conf.json.
# Run after `tauri ios init`, before building.
#
# - The app icon: `tauri ios init` fills Assets.xcassets with Tauri's own
#   placeholder icons; ours are in icons/ios (opaque, full-bleed - iOS cuts
#   the rounded corners itself).
# - PrivacyInfo.xcprivacy: the privacy manifest App Store Connect requires
#   (see the comment in the file). Everything in the <name>_iOS/ folder is
#   a source of the app target, so the file lands in the bundle; xcodegen
#   re-reads the folder so the project lists it.
set -eu
cd "$(dirname "$0")/../src-tauri"
cp icons/ios/*.png gen/apple/Assets.xcassets/AppIcon.appiconset/
# The folder is named after the crate (textus_iOS today), so it is found
# rather than spelled out: a rename must not quietly ship without the
# manifest.
set -- gen/apple/*_iOS/
if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
  echo "ios-prepare.sh: expected exactly one gen/apple/*_iOS folder, found: $*" >&2
  exit 1
fi
cp PrivacyInfo.ios.xcprivacy "$1PrivacyInfo.xcprivacy"
(cd gen/apple && xcodegen generate --spec project.yml --quiet)
