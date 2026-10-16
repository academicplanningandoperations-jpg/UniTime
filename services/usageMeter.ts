// Estimates this browser's Supabase egress — the data Supabase sends to the
// app — and reports a small running total every few minutes, so the System
// Administrator can track usage against the plan's quota.
//
// Supabase does not let an app read its exact egress figure (only its own
// dashboard shows it), so it is measured here:
//  • REST/Auth/function responses: the compressed size on the wire. Supabase
//    gzips JSON (~13× smaller), and Content-Length is that compressed size.
//    When a response has no Content-Length (streamed), its decoded size is
//    scaled down by the compression ratio seen on other responses.
//  • Realtime messages: the size of each change pushed to this browser.
// Slightly low by design — it skips connection overhead and the few requests
// made before sign-in.

const HEADER_OVERHEAD = 350;          // rough bytes of HTTP response headers
const FLUSH_EVERY_MS = 5 * 60 * 1000;

let pendingBytes = 0;
let pendingRequests = 0;
let pendingRealtime = 0;
let compressedSeen = 0;
let decodedSeen = 0;

const ratio = () => (compressedSeen > 0 && decodedSeen > 0 ? decodedSeen / compressedSeen : 8);

export const meteredFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  try {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
    if (!url.includes('/rpc/add_usage')) {
      pendingRequests++;
      const len = Number(res.headers.get('content-length'));
      if (len > 0) {
        pendingBytes += len + HEADER_OVERHEAD;
        if (res.headers.get('content-encoding')) {
          // Learn the compression ratio from responses where both sizes are known.
          res.clone().arrayBuffer().then(b => { compressedSeen += len; decodedSeen += b.byteLength; }).catch(() => {});
        }
      } else {
        res.clone().arrayBuffer()
          .then(b => { pendingBytes += Math.round(b.byteLength / ratio()) + HEADER_OVERHEAD; })
          .catch(() => {});
      }
    }
  } catch { /* metering must never break a request */ }
  return res;
};

export const UsageMeter = {
  recordRealtime(payload: unknown) {
    try {
      pendingRealtime++;
      pendingBytes += JSON.stringify(payload ?? '').length + 100;
    } catch { /* ignore */ }
  },
};

// Started once by the app after sign-in. `send` writes the totals to Supabase.
export function startUsageReporting(send: (bytes: number, requests: number, realtime: number) => Promise<boolean>) {
  const flush = async () => {
    if (pendingBytes === 0 && pendingRequests === 0 && pendingRealtime === 0) return;
    const b = pendingBytes, r = pendingRequests, m = pendingRealtime;
    pendingBytes = 0; pendingRequests = 0; pendingRealtime = 0;
    const ok = await send(b, r, m).catch(() => false);
    if (!ok) { pendingBytes += b; pendingRequests += r; pendingRealtime += m; } // retry next time
  };
  const timer = setInterval(flush, FLUSH_EVERY_MS);
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onHide);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onHide); flush(); };
}
