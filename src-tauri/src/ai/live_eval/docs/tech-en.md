# Uploading files with the Textus Sync API

## Quick start

1. Create an API token in **Settings > Developer**.
2. Install the client with `npm install @textus/sync`.
3. Call `upload()` with the file path and the target folder.

```js
import { SyncClient } from "@textus/sync";

const client = new SyncClient({ token: process.env.TEXTUS_TOKEN });

async function uploadAll(paths) {
  for (const path of paths) {
    client.upload(path, { folder: "drafts" });
  }
}
```

## Retries

Uploads that fail with a network error are retried automatically. The `retries` option sets how many times (default `3`), and `backoffMs` sets the delay before the first retry, which doubles after each attempt.