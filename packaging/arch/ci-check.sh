#!/usr/bin/env bash
# Builds levis-bin for one release, tests it the way a user gets it, and
# writes the signed pacman repository for that release:
#
#   1. Install levis-bin from the [catvinci] repository as it is now (the
#      previous release), exactly as a user configured per README.md would.
#   2. Build the new package from the release tarball and upgrade to it.
#   3. Check libraries, desktop entry, a 15 s start under Xvfb, removal.
#   4. Sign the package and build catvinci.db for it.
#
# Runs as root in an archlinux:base-devel container (.github/workflows/
# arch-repo.yml); makepkg itself runs as an unprivileged user.
#
# Usage: packaging/arch/ci-check.sh <version> <tarball-dir> <out-dir>
#   <tarball-dir> holds Levis_<version>_linux_x86_64.tar.gz and its .sha256.
#   ARCH_REPO_GPG_KEY holds the armored private signing key.
set -euo pipefail

version="$1"
tarball_dir="$(realpath "$2")"
out_dir="$(realpath -m "$3")"
pkgver="${version//-/_}"
here="$(cd "$(dirname "$0")" && pwd)"
work=/home/builder/levis-bin
repo=catvinci
server="https://github.com/CatVinci-Studio/Levis/releases/latest/download"
tarball="Levis_${version}_linux_x86_64.tar.gz"
pkgfile="levis-bin-${pkgver}-1-x86_64.pkg.tar.zst"

pacman -Syu --noconfirm --needed git pacman-contrib desktop-file-utils \
  xorg-server-xvfb curl
id builder >/dev/null 2>&1 || useradd -m builder
echo 'builder ALL=(ALL) NOPASSWD: ALL' >/etc/sudoers.d/builder
as_builder() { sudo -u builder -H bash -c "cd '$1' && ${*:2}"; }

# Signing key, in a keyring of its own.
export GNUPGHOME="$(mktemp -d)"
printf '%s\n' "${ARCH_REPO_GPG_KEY:?ARCH_REPO_GPG_KEY is not set}" | gpg --batch --import
key="$(gpg --list-secret-keys --with-colons | awk -F: '/^fpr/{print $10; exit}')"
pacman-key --init >/dev/null
pacman-key --add "$here/catvinci.asc"
pacman-key --lsign-key "$key"

# 1. The previous release, through the same steps a user runs.
previous=""
if curl -fsIL "$server/$repo.db" >/dev/null 2>&1; then
  printf '\n[%s]\nServer = %s\n' "$repo" "$server" >>/etc/pacman.conf
  pacman -Sy --noconfirm levis-bin
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

# 4. Signed package and repository database. GitHub release assets cannot
# be symlinks, so the .db and .files names are copies.
mkdir -p "$out_dir"
cp "$work/$pkgfile" "$out_dir/"
cp "$work/.SRCINFO" "$out_dir/SRCINFO"
cp "$work/PKGBUILD" "$out_dir/"
gpg --batch --yes --detach-sign --no-armor -u "$key" "$out_dir/$pkgfile"
(cd "$out_dir" && repo-add --sign --key "$key" "$repo.db.tar.gz" "$pkgfile")
for name in db files; do
  rm -f "$out_dir/$repo.$name" "$out_dir/$repo.$name.sig"
  cp "$out_dir/$repo.$name.tar.gz" "$out_dir/$repo.$name"
  cp "$out_dir/$repo.$name.tar.gz.sig" "$out_dir/$repo.$name.sig"
done
cp "$here/catvinci.asc" "$out_dir/"
gpg --batch --verify "$out_dir/$repo.db.sig" "$out_dir/$repo.db"
echo "levis-bin ${pkgver}-1: all checks passed"
ls -l "$out_dir"
