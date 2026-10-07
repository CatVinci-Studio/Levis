# levis-bin and the [catvinci] pacman repository

`PKGBUILD` repackages `Levis_<version>_linux_x86_64.tar.gz`, which
`.github/workflows/release.yml` attaches to every GitHub Release. That
binary is built with `LEVIS_DISTRIBUTION=aur`
(`src-tauri/src/distribution.rs`): it reports new versions, but the upgrade
goes through pacman.

## How users get it

Each release also carries a signed pacman repository named `catvinci`:
`levis-bin-<version>-1-x86_64.pkg.tar.zst`, `catvinci.db`, `catvinci.files`
and their `.sig` files. Users point pacman at
`https://github.com/CatVinci-Studio/Levis/releases/latest/download` (see the
Install section of the top-level README). GitHub resolves `latest` to the
newest published stable release, so:

- a draft is invisible until every platform built and the release is
  published;
- a pre-release is never served (`latest` excludes it).

## What CI does

`release.yml` calls `.github/workflows/arch-repo.yml` while the release is
still a draft. In an `archlinux:base-devel` container, `ci-check.sh`:

1. Installs `levis-bin` from `[catvinci]` as it is now (the previous
   release), with the same steps a user runs.
2. Builds the new package from the release tarball and upgrades to it.
3. Checks the libraries, the desktop entry, a 15 s start under Xvfb, and
   that `pacman -R` leaves no files behind.
4. Signs the package and builds `catvinci.db`.

Then the workflow uploads the files to the draft. If any step fails, the
release stays a draft and nobody gets the version.

To rebuild the repository files of one tag (for example after a fix to
these scripts), run Actions > Arch repository > Run workflow with that tag.

## Signing key

- Public key: `catvinci.asc`, fingerprint
  `98DB41F71D372A8190C1778130FBDF7CEF176258`. Every release carries a copy.
- Private key: the repository secret `ARCH_REPO_GPG_KEY` only.

To replace the key:

1. Make a new key without a passphrase.
2. Store the armored private key in `ARCH_REPO_GPG_KEY`.
3. Replace `catvinci.asc` and the fingerprint in the READMEs.
4. Release. Users then repeat the `pacman-key --add` and `--lsign-key` steps.

## The AUR

`PKGBUILD` is also a valid AUR `PKGBUILD`. To publish `levis-bin` there
later: register an AUR account, then push the `PKGBUILD` and `SRCINFO`
(renamed to `.SRCINFO`) that each release carries to
`ssh://aur@aur.archlinux.org/levis-bin.git`.
