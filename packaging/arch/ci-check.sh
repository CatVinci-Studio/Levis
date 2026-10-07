#!/usr/bin/env bash
# Builds levis-bin for one release and tests it the way a user gets it:
#
#   1. Install levis-bin from the [catvinci] repository
#      (CatVinci-Studio/arch-repo) as it is now - the previous release -
#      with install.sh, the one-line setup its README gives users.
#   2. Build the new package from the release tarball and upgrade to it.
#   3. Check libraries, desktop entry, a 15 s start under Xvfb, removal.
#
# arch-repo signs the package and adds it to catvinci.db after the release
# is published (release.yml, update-arch-repo).
#
# Runs as root in an archlinux:base-devel container (.github/workflows/
# arch-package.yml); makepkg itself runs as an unprivileged user.
#
# Usage: packaging/arch/ci-check.sh <version> <tarball-dir> <out-dir>
#   <tarball-dir> holds Levis_<version>_linux_x86_64.tar.gz and its .sha256.
set -euo pipefail

version="$1"
tarball_dir="$(realpath "$2")"
out_dir="$(realpath -m "$3")"
pkgver="${version//-/_}"
here="$(cd "$(dirname "$0")" && pwd)"
work=/home/builder/levis-bin
repo=catvinci
server='https://github.com/CatVinci-Studio/arch-repo/releases/download/$arch'
install_sh="https://raw.githubusercontent.com/CatVinci-Studio/arch-repo/main/install.sh"
tarball="Levis_${version}_linux_x86_64.tar.gz"
pkgfile="levis-bin-${pkgver}-1-x86_64.pkg.tar.zst"

pacman -Syu --noconfirm --needed git pacman-contrib desktop-file-utils \
  xorg-server-xvfb curl
id builder >/dev/null 2>&1 || useradd -m builder
echo 'builder ALL=(ALL) NOPASSWD: ALL' >/etc/sudoers.d/builder
as_builder() { sudo -u builder -H bash -c "cd '$1' && ${*:2}"; }

# 1. The previous release, through the same steps a user runs.
previous=""
if curl -fsIL "${server/\$arch/x86_64}/$repo.db" >/dev/null 2>&1; then
  pacman-key --init >/dev/null
  bash <(curl -fsSL "$install_sh")
  pacman -S --noconfirm levis-bin
  previous="$(pacman -Q levis-bin)"
  echo "Installed from [$repo]: $previous"
  sudo -u builder mkdir -p /home/builder/.config/levis-upgrade-check
  sudo -u builder touch /home/builder/.config/levis-upgrade-check/keep
fi

# 2. Build and upgrade. makepkg uses the tarball next to the PKGBUILD
# instead of downloading it, so this works while the release is a draft.
rm -rf "$work"
mkdir -p "$work"
cp "$here/PKGBUILD" "$tarball_dir/$tarball" "$work/"
sed -i "s/^pkgver=.*/pkgver=${pkgver}/; s/^_version=.*/_version=${version}/; s/^pkgrel=.*/pkgrel=1/" \
  "$work/PKGBUILD"
chown -R builder: "$work"
as_builder "$work" updpkgsums
expected="$(cut -d' ' -f1 "$tarball_dir/$tarball.sha256")"
grep -q "sha256sums=('${expected}')" "$work/PKGBUILD" || {
  echo "sha256 in PKGBUILD does not match $tarball.sha256 ($expected)" >&2
  exit 1
}
as_builder "$work" 'makepkg --printsrcinfo > .SRCINFO'
as_builder "$work" makepkg -sf --noconfirm
pacman -U --noconfirm "$work/$pkgfile"

installed="$(pacman -Q levis-bin)"
[ "$installed" = "levis-bin ${pkgver}-1" ] || {
  echo "expected levis-bin ${pkgver}-1, got: $installed" >&2
  exit 1
}
if [ -n "$previous" ]; then
  echo "Upgrade: $previous -> $installed"
  [ -f /home/builder/.config/levis-upgrade-check/keep ] || {
    echo "user config disappeared during the upgrade" >&2
    exit 1
  }
fi

# 3. Checks.
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

# The package, plus PKGBUILD and SRCINFO for a later AUR import.
mkdir -p "$out_dir"
cp "$work/$pkgfile" "$work/PKGBUILD" "$out_dir/"
cp "$work/.SRCINFO" "$out_dir/SRCINFO"
echo "levis-bin ${pkgver}-1: all checks passed"
ls -l "$out_dir"
