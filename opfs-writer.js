// OPFS Writer Worker
// Streams a file URL directly to OPFS using createSyncAccessHandle().
// Main thread posts: { url: string, expectedSize: number }
// Worker posts back: { type: 'progress', loaded: number, total: number }
//                    { type: 'done' }
//                    { type: 'error', message: string }
//
// [Atomic-swap fix, 2026-07-22] Downloads into slk_points.sqlite.NEW — never the real
// slk_points.sqlite. The pilot's existing working database is not touched here at all;
// the main thread verifies this .new file and only then swaps it into place. A failed or
// interrupted download therefore leaves the real database exactly as it was.
const DOWNLOAD_NAME = 'slk_points.sqlite.new';

self.onmessage = async function(e) {
  const { url, expectedSize } = e.data;
  let sah = null;

  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(DOWNLOAD_NAME, { create: true });

    // createSyncAccessHandle() writes directly to disk — no internal buffering.
    // Only available inside a Worker (not the main thread).
    try {
      sah = await fh.createSyncAccessHandle();
    } catch (err) {
      // Samsung Internet <21 does not support createSyncAccessHandle()
      if (err instanceof TypeError) {
        self.postMessage({ type: 'error', message: 'Use Chrome or Safari to download this file' });
        return;
      }
      throw err;
    }

    // Clear any stale or partial data from a previous interrupted download.
    // Without this, a truncated file from a prior attempt would have valid-looking
    // tail bytes from the old version appended after the new data ends.
    sah.truncate(0);

    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    const reader = resp.body.getReader();
    let offset = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sah.write(value, { at: offset });
      offset += value.length;
      // Progress denominator is expectedSize (uncompressed) — not Content-Length
      // which reflects the compressed transfer size and would make progress
      // appear to reach 100% at roughly 50% of the actual file written.
      self.postMessage({ type: 'progress', loaded: offset, total: expectedSize });
    }

    sah.flush();
    sah.close();
    self.postMessage({ type: 'done' });

  } catch (err) {
    if (sah) { try { sah.close(); } catch (_) {} }
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
