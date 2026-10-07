#!/usr/bin/env bash
# Packs a Linux build into the tarball that packaging/arch/PKGBUILD installs:
#
#   Levis/
#   ├── bin/levis
#   └── share/
#       ├── applications/levis.desktop
#       ├── icons/hicolor/<size>/apps/levis.png
#       └── licenses/levis/LICENSE
#
# Usage: scripts/package-linux-tarball.sh <version> <binary> <out-dir>
# Build the binary with LEVIS_DISTRIBUTION=aur so it does not update itself.
set -euo pipefail

version="$1"
binary="$2"
out_dir="$3"
root="$(cd "$(dirname "$0")/.." && pwd)"
icons="$root/src-tauri/icons"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
app="$stage/Levis"

install -Dm755 "$binary" "$app/bin/levis"
install -Dm644 "$root/packaging/linux/levis.desktop" \
  "$app/share/applications/levis.desktop"
install -Dm644 "$root/LICENSE" "$app/share/licenses/levis/LICENSE"
for pair in 32x32:32x32.png 64x64:64x64.png 128x128:128x128.png \
  256x256:128x128@2x.png 512x512:icon.png; do
  size="${pair%%:*}"
  file="${pair#*:}"
  install -Dm644 "$icons/$file" "$app/share/icons/hicolor/$size/apps/levis.png"
done

mkdir -p "$out_dir"
tarball="$out_dir/Levis_${version}_linux_x86_64.tar.gz"
# Fixed owner, order and mtime: the same inputs give the same sha256.
tar --sort=name --owner=0 --group=0 --numeric-owner \
  --mtime="@${SOURCE_DATE_EPOCH:-0}" -C "$stage" -czf "$tarball" Levis
(cd "$out_dir" && sha256sum "$(basename "$tarball")" >"$(basename "$tarball").sha256")
echo "$tarball"
