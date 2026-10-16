#!/usr/bin/env bash
# Copies a release's installers from GitHub to our own R2 bucket
# (textus-downloads), so the site's download buttons don't depend on GitHub,
# which is slow or unreachable from some networks. The site
# (CatVinci-Studio/levis-homepage) reads manifest.json through its
# functions/download/[[path]].js and falls back to GitHub; the updater,
# Homebrew and Arch keep using the GitHub release.
#
#   scripts/mirror-downloads.sh v1.0.0
#
# release.yml runs it after publishing, with CLOUDFLARE_API_TOKEN (R2 edit)
# from the repository secrets. By hand it needs gh logged in and wrangler
# logged in to the "ChengAo Home" account.
set -euo pipefail
tag="${1:?usage: mirror-downloads.sh vX.Y.Z}"
repo=CatVinci-Studio/Textus
bucket=textus-downloads
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-49abb4d436c552f6e4497b1782fc9beb}"

work="$(mktemp -d)"
trap 'echo "downloaded files left in $work"' EXIT
gh release download "$tag" --repo "$repo" --dir "$work" \
  --pattern '*_aarch64.dmg' --pattern '*-setup.exe' --pattern '*.AppImage' \
  --pattern '*.deb' --pattern '*.rpm'

# One object up, retried: a large upload now and then drops its connection.
put() {
  for attempt in 1 2 3; do
    if npx -y wrangler@4 r2 object put "$bucket/$1" --file "$2" --remote \
      --content-type "$3" >/dev/null; then
      return 0
    fi
    echo "  retrying $1 ($attempt)" >&2
    sleep 5
  done
  return 1
}

declare -A key
for f in "$work"/*; do
  name="$(basename "$f")"
  case "$name" in
    *_aarch64.dmg) key[mac]="$name" ;;
    *-setup.exe) key[windows]="$name" ;;
    *.AppImage) key[linux]="$name" ;;
    *.deb) key[deb]="$name" ;;
    *.rpm) key[rpm]="$name" ;;
    *) continue ;;
  esac
  echo "uploading $name"
  put "releases/$tag/$name" "$f" application/octet-stream
done

# The manifest the site reads: the version and each platform's file.
manifest="$work/manifest.json"
{
  printf '{\n  "tag": "%s",\n  "version": "%s",\n  "files": {\n' "$tag" "${tag#v}"
  first=1
  for p in mac windows linux deb rpm; do
    [ -n "${key[$p]:-}" ] || continue
    [ $first = 1 ] || printf ',\n'
    printf '    "%s": "releases/%s/%s"' "$p" "$tag" "${key[$p]}"
    first=0
  done
  printf '\n  }\n}\n'
} >"$manifest"
cat "$manifest"
put manifest.json "$manifest" application/json
echo "mirrored $tag"
