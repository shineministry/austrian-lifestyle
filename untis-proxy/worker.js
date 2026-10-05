/* WebUntis CORS proxy — Cloudflare Worker (free tier)
 *
 * WHY: WebUntis sends no Access-Control-Allow-Origin header, so a browser page
 * (e.g. this site on GitHub Pages) cannot fetch a school calendar directly.
 * This worker fetches it server-side and adds the CORS header.
 *
 * DEPLOY (no command line needed, ~2 minutes):
 *   1. Sign up at https://dash.cloudflare.com (free plan is enough).
 *   2. Left sidebar → Workers & Pages → Create → Worker → "Start with Hello World".
 *   3. Name it (e.g. untis-proxy) → Deploy.
 *   4. Click "Edit code", delete everything, paste this file, then "Deploy".
 *   5. Your proxy prefix is: https://<name>.<account>.workers.dev/?url=
 *      Paste that into "CORS proxy prefix" on the dashboard's WebUntis panel.
 *
 * ALTERNATIVE (command line):  npx wrangler deploy untis-proxy/worker.js
 *
 * SECURITY: only WebUntis hosts are proxied, so this cannot be used as a
 * general open proxy. Your calendar token travels through your own worker —
 * you control it, nobody else does.
 */

const ALLOWED_HOSTS = ['webuntis.com', 'webuntis.at', 'untis.at'];

function cors(extra) {
  return Object.assign({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'Accept, Content-Type',
    'access-control-max-age': '86400'
  }, extra || {});
}

function text(message, status) {
  return new Response(message, {
    status: status,
    headers: cors({ 'content-type': 'text/plain; charset=utf-8' })
  });
}

function allowed(hostname) {
  return ALLOWED_HOSTS.some(function (zone) {
    return hostname === zone || hostname.endsWith('.' + zone);
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

    const incoming = new URL(request.url);
    const target = incoming.searchParams.get('url');
    if (!target) return text('Missing ?url= parameter', 400);

    let dest;
    try { dest = new URL(target); } catch (e) { return text('Invalid url parameter', 400); }
    if (dest.protocol !== 'https:') return text('Only https targets are allowed', 400);
    if (!allowed(dest.hostname)) return text('Host not allowed: ' + dest.hostname, 403);

    let upstream;
    try {
      upstream = await fetch(dest.toString(), {
        method: 'GET',
        redirect: 'follow',
        headers: { 'accept': request.headers.get('accept') || 'text/calendar, */*' }
      });
    } catch (e) {
      return text('Upstream request failed: ' + e.message, 502);
    }

    const headers = cors({
      'cache-control': 'public, max-age=300',
      'x-proxy': 'untis-cors'
    });
    const type = upstream.headers.get('content-type');
    if (type) headers['content-type'] = type;

    return new Response(upstream.body, { status: upstream.status, headers: headers });
  }
};
