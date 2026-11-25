#!/usr/bin/env bash
# Builds an UNSIGNED SearchX.ipa for sideloading (AltStore, SideStore, Sideloadly, TrollStore…).
# Requires macOS with Xcode 15.3+ and XcodeGen (brew install xcodegen).
set -euo pipefail
mkdir -p "$(dirname "$0")/../build"
cd "$(dirname "$0")/.."

xcodegen generate

xcodebuild \
  -project SearchX.xcodeproj \
  -scheme SearchX \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  build 2>&1 | tee build.log | (command -v xcpretty >/dev/null && xcpretty || cat)

APP="build/Build/Products/Release-iphoneos/SearchX.app"
[ -d "$APP" ] || { echo "Build product not found: $APP" >&2; exit 1; }

rm -rf build/Payload build/SearchX.ipa
mkdir -p build/Payload
cp -R "$APP" build/Payload/
(cd build && zip -qry SearchX.ipa Payload)
echo "Created $(pwd)/build/SearchX.ipa"
