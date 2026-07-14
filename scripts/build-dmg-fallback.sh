#!/usr/bin/env bash

# Finder-free macOS DMG fallback for local and CI diagnostics.
#
# Usage:
#   scripts/build-dmg-fallback.sh [path/to/App.app] [path/to/output.dmg]
#
# When APP is omitted, exactly one release .app must exist below
# src-tauri/target. The output defaults next to the app and includes its
# bundle version and target architecture in the same style as Tauri bundles.

set -Eeuo pipefail

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

for tool in ditto hdiutil plutil shasum; do
  command -v "$tool" >/dev/null 2>&1 || fail "required macOS tool is missing: $tool"
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "this fallback uses hdiutil and must run on macOS"
fi

if (( $# > 2 )); then
  fail "usage: $0 [path/to/App.app] [path/to/output.dmg]"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
APP_PATH="${1:-}"

if [[ -z "$APP_PATH" ]]; then
  candidates=()
  while IFS= read -r -d '' candidate; do
    candidates+=("$candidate")
  done < <(find "$PROJECT_ROOT/src-tauri/target" -type d \
    -path '*/release/bundle/macos/*.app' -print0 2>/dev/null)

  if (( ${#candidates[@]} == 0 )); then
    fail "no release .app found; build the app bundle first or pass its path"
  elif (( ${#candidates[@]} > 1 )); then
    printf 'Multiple release app bundles were found; pass one explicitly:\n' >&2
    printf '  %s\n' "${candidates[@]}" >&2
    exit 1
  fi
  APP_PATH="${candidates[0]}"
fi

[[ -d "$APP_PATH" ]] || fail "app bundle does not exist: $APP_PATH"
APP_PARENT="$(cd "$(dirname "$APP_PATH")" && pwd -P)"
APP_PATH="$APP_PARENT/$(basename "$APP_PATH")"
APP_NAME="$(basename "$APP_PATH")"
APP_STEM="${APP_NAME%.app}"
INFO_PLIST="$APP_PATH/Contents/Info.plist"

[[ "$APP_NAME" == *.app ]] || fail "input must be a .app bundle: $APP_PATH"
[[ -f "$INFO_PLIST" ]] || fail "app is missing Contents/Info.plist: $APP_PATH"
plutil -lint "$INFO_PLIST" >/dev/null || fail "app Info.plist is invalid"

BUNDLE_EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$INFO_PLIST" 2>/dev/null)" \
  || fail "CFBundleExecutable is missing from Info.plist"
[[ -x "$APP_PATH/Contents/MacOS/$BUNDLE_EXECUTABLE" ]] \
  || fail "app executable is missing or not executable: $BUNDLE_EXECUTABLE"

BUNDLE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST" 2>/dev/null || true)"
[[ -n "$BUNDLE_VERSION" ]] || BUNDLE_VERSION="unknown"

TARGET_SUFFIX=""
case "$APP_PATH" in
  */universal-apple-darwin/*) TARGET_SUFFIX="_universal" ;;
  */aarch64-apple-darwin/*) TARGET_SUFFIX="_aarch64" ;;
  */x86_64-apple-darwin/*) TARGET_SUFFIX="_x64" ;;
esac

OUTPUT_PATH="${2:-$APP_PARENT/${APP_STEM}_${BUNDLE_VERSION}${TARGET_SUFFIX}.dmg}"
OUTPUT_DIR="$(dirname "$OUTPUT_PATH")"
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd -P)"
OUTPUT_PATH="$OUTPUT_DIR/$(basename "$OUTPUT_PATH")"
[[ "$OUTPUT_PATH" == *.dmg ]] || fail "output path must end in .dmg: $OUTPUT_PATH"

VOLUME_NAME="${GAOGAO_DMG_VOLUME_NAME:-$APP_STEM}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gaogao-dmg.XXXXXX")"
STAGING_DIR="$WORK_DIR/staging"
MOUNT_DIR="$WORK_DIR/mount"
TEMP_DMG="$OUTPUT_PATH.tmp.$$.dmg"
MOUNTED=0

cleanup() {
  if (( MOUNTED )); then
    hdiutil detach "$MOUNT_DIR" -force -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR"
  rm -f "$TEMP_DMG"
}
trap cleanup EXIT INT TERM

mkdir -p "$STAGING_DIR" "$MOUNT_DIR"
ditto --rsrc --extattr --acl "$APP_PATH" "$STAGING_DIR/$APP_NAME"
ln -s /Applications "$STAGING_DIR/Applications"

printf 'Creating Finder-free DMG from %s\n' "$APP_PATH"
hdiutil create \
  -quiet \
  -ov \
  -fs HFS+ \
  -format UDZO \
  -imagekey zlib-level=9 \
  -volname "$VOLUME_NAME" \
  -srcfolder "$STAGING_DIR" \
  "$TEMP_DMG"

# Verify before replacing an existing artifact, so a failed conversion never
# destroys a previously usable DMG.
hdiutil verify "$TEMP_DMG" >/dev/null
mv -f "$TEMP_DMG" "$OUTPUT_PATH"
hdiutil verify "$OUTPUT_PATH" >/dev/null

hdiutil attach \
  -quiet \
  -readonly \
  -nobrowse \
  -noautoopen \
  -mountpoint "$MOUNT_DIR" \
  "$OUTPUT_PATH"
MOUNTED=1

[[ -d "$MOUNT_DIR/$APP_NAME" ]] || fail "verified image is missing $APP_NAME"
[[ -L "$MOUNT_DIR/Applications" ]] || fail "verified image is missing Applications symlink"
[[ "$(readlink "$MOUNT_DIR/Applications")" == "/Applications" ]] \
  || fail "Applications symlink has the wrong target"
plutil -lint "$MOUNT_DIR/$APP_NAME/Contents/Info.plist" >/dev/null \
  || fail "mounted app Info.plist is invalid"
[[ -x "$MOUNT_DIR/$APP_NAME/Contents/MacOS/$BUNDLE_EXECUTABLE" ]] \
  || fail "mounted app executable is missing or not executable"

hdiutil detach "$MOUNT_DIR" -quiet
MOUNTED=0

DIGEST="$(shasum -a 256 "$OUTPUT_PATH" | awk '{print $1}')"
SIZE_BYTES="$(stat -f '%z' "$OUTPUT_PATH")"

printf 'Verified fallback DMG: %s\n' "$OUTPUT_PATH"
printf '  hdiutil checksum: OK\n'
printf '  app bundle: %s\n' "$APP_NAME"
printf '  Applications symlink: /Applications\n'
printf '  size: %s bytes\n' "$SIZE_BYTES"
printf '  sha256: %s\n' "$DIGEST"
