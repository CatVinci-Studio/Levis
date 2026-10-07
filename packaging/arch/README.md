# levis-bin (AUR)

`PKGBUILD` repackages `Levis_<version>_linux_x86_64.tar.gz`, which
`.github/workflows/release.yml` attaches to every GitHub Release. That
binary is built with `LEVIS_DISTRIBUTION=aur`
(`src-tauri/src/distribution.rs`): it reports new versions, but the upgrade
goes through pacman.

## Test a build before a release exists

makepkg uses a source file that is already next to the `PKGBUILD` and does
not download it.

1. On a Linux machine with the build dependencies, build the binary:
   `LEVIS_DISTRIBUTION=aur npx tauri build --no-bundle`
2. Pack it:
   `scripts/package-linux-tarball.sh 0.8.13 src-tauri/target/release/levis packaging/arch`
3. On Arch, in `packaging/arch`, write the checksum: `updpkgsums`
4. Build and install: `makepkg -si`
5. Make sure that `pacman -Q levis-bin` shows `levis-bin 0.8.13-1`.
6. Check: `levis` starts, the menu entry and icon show, `.md` files open
   with Levis, and Settings > General shows "Update it there" instead of an
   install button when a newer release exists.
7. Remove it: `sudo pacman -R levis-bin`. Make sure that no file stays in
   `/usr` (`pacman -Ql levis-bin` before removal lists them).

NOTE: `.gitignore` excludes the tarball and the makepkg outputs. Before you
commit, set `sha256sums` back to `SKIP` or to the checksum of the real
release tarball.

## Upgrade test

1. Build and install `pkgver=0.8.12` with the procedure above
   (`sudo pacman -U levis-bin-0.8.12-1-x86_64.pkg.tar.zst`).
2. Open Levis once and change a setting.
3. Build `pkgver=0.8.13` and install it with `sudo pacman -U`.
4. Make sure that `pacman -Q levis-bin` shows `levis-bin 0.8.13-1` and that
   the setting from step 2 is still there.

## Publish a version to the AUR

`.github/workflows/aur.yml` does this after every stable release:
`ci-check.sh` fills in `pkgver` and `sha256sums`, writes `.SRCINFO`, and
tests install, start, upgrade from the current AUR version, and removal in
an Arch container. Then the workflow pushes `PKGBUILD` and `.SRCINFO` to
the AUR. The `PKGBUILD` in this directory stays a template with `SKIP`.

To set up or repair the push:

1. Register an SSH public key on the AUR account that owns `levis-bin`.
2. Store the private key as the repository secret `AUR_SSH_PRIVATE_KEY`.
3. Run the AUR workflow by hand (Actions > AUR > Run workflow) with the
   release tag.

Without the secret the workflow still tests the package and keeps
`PKGBUILD` and `.SRCINFO` as a workflow artifact. To push them by hand,
copy both files into a clone of `ssh://aur@aur.archlinux.org/levis-bin.git`,
then commit and push.
