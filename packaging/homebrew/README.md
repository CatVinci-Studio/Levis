# The `textus` Homebrew cask

`textus.rb` is the cask the release workflow puts into
[CatVinci-Studio/homebrew-tap](https://github.com/CatVinci-Studio/homebrew-tap)
as `Casks/textus.rb`. Users install it with:

```sh
brew install --cask catvinci-studio/tap/textus
```

Levis, Textus's name before 1.0.0, was the `levis` cask. The first Textus
release renames it in the tap in one commit, after the release is
published (`update-homebrew-tap` in `.github/workflows/release.yml`):

- `Casks/textus.rb` is created from this file, with the release's version
  and the DMG's sha256;
- `Casks/levis.rb` is removed;
- `cask_renames.json` maps `levis` to `textus`, so `brew upgrade` moves a
  Levis install to Textus. Levis's data in
  `~/Library/Application Support/com.chengaoshen.levis` is left alone, and
  Textus offers to import it on its first start.

Later releases only update `version` and `sha256` in `Casks/textus.rb`.
Edit this file when the cask itself changes (a new `zap` path, a macOS
requirement) and copy the change into the tap.
