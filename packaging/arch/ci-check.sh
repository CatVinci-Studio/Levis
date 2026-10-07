#!/usr/bin/env bash
# Builds levis-bin for one released version and tests it the way a user
# gets it: install, start, upgrade from the version on the AUR (when there
# is one), remove. Runs as root in an archlinux:base-devel container (see
# .github/workflows/aur.yml); makepkg itself runs as an unprivileged user.
#
# Usage: packaging/arch/ci-check.sh <version>
# Leaves the finished PKGBUILD and .SRCINFO in /home/builder/levis-bin.
set -euo pipefail

version="$1"
here="$(cd "$(dirname "$0")" && pwd)"
work=/home/builder/levis-bin
release="https://github.com/CatVinci-Studio/Levis/releases/download/v${version}"
tarball="Levis_${version}_linux_x86_64.tar.gz"

pacman -Syu --noconfirm --needed git openssh pacman-contrib \
  desktop-file-utils xorg-server-xvfb curl
id builder >/dev/null 2>&1 || useradd -m builder
echo 'builder ALL=(ALL) NOPASSWD: ALL' >/etc/sudoers.d/builder
as_builder() { sudo -u builder -H bash -c "cd '$1' && ${*:2}"; }

# Build and install the package that is on the AUR now, if there is one,
# so the install below is a real upgrade.
previous=""
if git ls-remote --exit-code https://aur.archlinux.org/levis-bin.git HEAD >/dev/null 2>&1; then
  rm -rf /home/builder/previous
  sudo -u builder git clone -q https://aur.archlinux.org/levis-bin.git /home/builder/previous
  if [ -f /home/builder/previous/PKGBUILD ]; then
    as_builder /home/builder/previous makepkg -si --noconfirm
    previous="$(pacman -Q levis-bin)"
    echo "Installed previous AUR package: $previous"
    # The previous version makes the settings file; the upgrade must keep it.
    sudo -u builder mkdir -p /home/builder/.config/levis-upgrade-check
    sudo -u builder touch /home/builder/.config/levis-upgrade-check/keep
  fi
fi

rm -rf "$work"
mkdir -p "$work"
cp "$here/PKGBUILD" "$work/"
sed -i "s/^pkgver=.*/pkgver=${version}/; s/^pkgrel=.*/pkgrel=1/" "$work/PKGBUILD"
chown -R builder: "$work"

as_builder "$work" updpkgsums
expected="$(curl -fsSL "$release/$tarball.sha256" | cut -d' ' -f1)"
grep -q "sha256sums=('${expected}')" "$work/PKGBUILD" || {
  echo "sha256 in PKGBUILD does not match $tarball.sha256 ($expected)" >&2
  exit 1
}
as_builder "$work" 'makepkg --printsrcinfo > .SRCINFO'
as_builder "$work" makepkg -sf --noconfirm
pacman -U --noconfirm "$work"/levis-bin-"${version}"-1-x86_64.pkg.tar.zst

installed="$(pacman -Q levis-bin)"
[ "$installed" = "levis-bin ${version}-1" ] || {
  echo "expected levis-bin ${version}-1, got: $installed" >&2
  exit 1
}
if [ -n "$previous" ]; then
  echo "Upgrade: $previous -> $installed"
  [ -f /home/builder/.config/levis-upgrade-check/keep ] || {
    echo "user config disappeared during the upgrade" >&2
    exit 1
  }
fi

if ldd /usr/bin/levis | grep 'not found'; then
  echo "levis needs libraries that the package does not depend on" >&2
  exit 1
fi
desktop-file-validate /usr/share/applications/levis.desktop
test -f /usr/share/icons/hicolor/256x256/apps/levis.png
test -f /usr/share/licenses/levis-bin/LICENSE

# A window cannot be checked here, but a missing library, a GTK/WebKit
# init failure or an early panic exits before the timeout. Exit 124 means
# Levis was still running after 15 s.
set +e
sudo -u builder -H env LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  xvfb-run -a timeout 15 /usr/bin/levis
status=$?
set -e
[ "$status" -eq 124 ] || {
  echo "levis exited early with status $status" >&2
  exit 1
}

files="$(pacman -Qlq levis-bin | grep -v '/$')"
pacman -R --noconfirm levis-bin
for f in $files; do
  if [ -e "$f" ]; then
    echo "left behind after pacman -R: $f" >&2
    exit 1
  fi
done
echo "levis-bin ${version}-1: all checks passed"
