#!/bin/sh
# Adds what the generated iOS project (src-tauri/gen/apple, made by
# `tauri ios init` and not committed) does not get from tauri.conf.json.
# Run after `tauri ios init`, before building.
#
# - PrivacyInfo.xcprivacy: the privacy manifest App Store Connect requires
#   (see the comment in the file). Everything in levis_iOS/ is a source of
#   the app target, so the file lands in the bundle; xcodegen re-reads the
#   folder so the project lists it.
set -eu
cd "$(dirname "$0")/../src-tauri"
cp PrivacyInfo.ios.xcprivacy gen/apple/levis_iOS/PrivacyInfo.xcprivacy
(cd gen/apple && xcodegen generate --spec project.yml --quiet)
