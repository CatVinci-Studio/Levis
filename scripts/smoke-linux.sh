#!/usr/bin/env bash
# Smoke test for the built Linux app - the parts the Playwright suite
# (e2e/, a browser against the dev server) can't reach:
#
#   1. the .deb carries the binary, icons and a .desktop entry that takes
#      files (Exec=textus %F) and claims Markdown;
#   2. the release binary starts and opens the file it is given;
#   3. a second launch hands its file to the first instance and exits
#      (tauri-plugin-single-instance, release builds only);
#   4. optionally, a screenshot of the window (niri only).
#
# Usage: scripts/smoke-linux.sh [--build] [--screenshot <out.png>]
#   --build       build the release binary and .deb first
#   --screenshot  focus the first window and save the screen to <out.png>
#
# The app runs with throwaway XDG config/data/cache directories, so it
# neither reads nor writes your real settings, session or recent files.
# Window checks use `niri msg`; on other desktops they're skipped.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
build=0
shot=""
while [ $# -gt 0 ]; do
  case "$1" in
    --build) build=1 ;;
    --screenshot)
      shot="$(realpath -m "$2")"
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() {
  printf '  \033[31mFAIL\033[0m %s\n' "$1"
  exit 1
}

version="$(node -p "require('$root/package.json').version")"
binary="$root/src-tauri/target/release/textus"
deb="$root/src-tauri/target/release/bundle/deb/Textus_${version}_amd64.deb"

if [ "$build" = 1 ]; then
  # No updater artifacts: signing them needs the release key, which only CI has.
  (cd "$root" && npm run tauri build -- --bundles deb \
    -c '{"bundle":{"createUpdaterArtifacts":false}}')
fi
[ -x "$binary" ] || fail "no release binary at $binary (run with --build)"
[ -f "$deb" ] || fail "no package at $deb (run with --build)"

if pgrep -x textus > /dev/null; then
  fail "Textus is already running; quit it first (a second instance would forward to it)"
fi

work="$(mktemp -d)"
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2> /dev/null || true; done
  rm -rf "$work"
}
trap cleanup EXIT

echo "package: $(basename "$deb")"
mkdir "$work/deb"
(cd "$work/deb" && ar x "$deb" && mkdir data && tar -xf data.tar.* -C data)
data="$work/deb/data"
[ -x "$data/usr/bin/textus" ] && pass "binary in /usr/bin" || fail "no /usr/bin/textus in the package"
desktop="$(find "$data/usr/share/applications" -name '*.desktop' | head -n1)"
[ -n "$desktop" ] || fail "no .desktop entry in the package"
grep -qx 'Exec=textus %F' "$desktop" && pass ".desktop Exec takes files" ||
  fail ".desktop Exec line: $(grep '^Exec=' "$desktop")"
grep -q '^MimeType=.*text/markdown' "$desktop" && pass ".desktop claims text/markdown" ||
  fail ".desktop has no Markdown MimeType"
grep -qx 'StartupWMClass=textus' "$desktop" && pass ".desktop StartupWMClass" ||
  fail ".desktop StartupWMClass missing"
find "$data/usr/share/icons" -name 'textus.png' | grep -q . && pass "icons installed" ||
  fail "no textus.png icons in the package"

export XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
printf '# Smoke first\n\nOpened by the smoke test.\n' > "$work/smoke-first.md"
printf '# Smoke second\n\nForwarded by a second launch.\n' > "$work/smoke-second.md"

have_niri=0
if command -v niri > /dev/null && niri msg version > /dev/null 2>&1; then have_niri=1; fi

# Titles of the windows owned by process $1, one per line.
window_titles() {
  niri msg --json windows | node -e '
    const pid = Number(process.argv[1]);
    let s = ""; process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      for (const w of JSON.parse(s)) if (w.pid === pid) console.log(w.title);
    });' "$1"
}

window_id() {
  niri msg --json windows | node -e '
    const pid = Number(process.argv[1]);
    let s = ""; process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      const w = JSON.parse(s).find((w) => w.pid === pid);
      if (w) console.log(w.id);
    });' "$1"
}

# Waits up to $2 seconds for a window of process $1 whose title has $3.
wait_for_title() {
  for _ in $(seq 1 $(($2 * 4))); do
    window_titles "$1" | grep -qF "$3" && return 0
    sleep 0.25
  done
  return 1
}

echo "launch: $binary"
(cd "$work" && exec "$binary" smoke-first.md > "$work/first.log" 2>&1) &
first=$!
pids+=("$first")
sleep 1
kill -0 "$first" 2> /dev/null && pass "first instance is running" ||
  fail "the app exited at startup: $(tail -n5 "$work/first.log")"

if [ "$have_niri" = 1 ]; then
  wait_for_title "$first" 20 "smoke-first" && pass "window opened on smoke-first.md" ||
    fail "no window titled smoke-first (windows: $(window_titles "$first" | paste -sd,))"
else
  echo "  skip window checks (not running under niri)"
  sleep 4
fi

# A relative path: the receiving instance must resolve it against the
# second launch's working directory, not its own.
mkdir "$work/elsewhere"
mv "$work/smoke-second.md" "$work/elsewhere/"
start=$(date +%s)
(cd "$work/elsewhere" && timeout 15 "$binary" smoke-second.md > "$work/second.log" 2>&1) &&
  status=0 || status=$?
[ "$status" = 0 ] && [ $(($(date +%s) - start)) -lt 10 ] &&
  pass "second launch exited after handing over" ||
  fail "second launch did not exit promptly (status $status): $(tail -n5 "$work/second.log")"
if [ "$have_niri" = 1 ]; then
  wait_for_title "$first" 10 "smoke-second" && pass "first instance opened the forwarded file" ||
    fail "forwarded file never opened (windows: $(window_titles "$first" | paste -sd,))"
fi

if [ -n "$shot" ]; then
  if [ "$have_niri" = 1 ] && command -v gdbus > /dev/null; then
    # niri's GNOME screenshot interface: the focused output, written to a
    # fixed path whatever file name is asked for. Focus the window first.
    niri msg action focus-window --id "$(window_id "$first")"
    sleep 1
    result="$(gdbus call --session --dest org.gnome.Shell.Screenshot \
      --object-path /org/gnome/Shell/Screenshot \
      --method org.gnome.Shell.Screenshot.Screenshot false false "$shot")"
    written="$(sed -n "s/^(true, '\(.*\)')$/\1/p" <<< "$result")"
    [ -n "$written" ] && [ "$written" != "$shot" ] && mv "$written" "$shot"
    [ -s "$shot" ] && pass "screenshot saved to $shot" || fail "screenshot failed: $result"
  else
    echo "  skip screenshot (needs niri and gdbus)"
  fi
fi

echo "all smoke checks passed"
