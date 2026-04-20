export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(url);
    new URL(targetUrl);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: 'Only http/https URLs allowed' });
  }

  // Try smart API routes first for known wiki sites
  const apiResult = await tryWikiApi(targetUrl);
  if (apiResult) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Via-Api', 'true');
    return res.status(200).send(apiResult);
  }

  // Standard fetch for non-wiki sites
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const parsed = new URL(targetUrl);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9,en-US;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Referer': parsed.origin + '/',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);
    const html = await response.text();

    if (
      html.includes('Just a moment') ||
      html.includes('cf-browser-verification') ||
      html.includes('_cf_chl') ||
      html.includes('challenge-platform') ||
      response.status === 403 ||
      response.status === 503
    ) {
      return res.status(403).json({ error: 'cloudflare', message: 'Blocked by Cloudflare.' });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(html);

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'timeout', message: 'Request timed out.' });
    }
    return res.status(502).json({ error: 'fetch_failed', message: err.message });
  }
}

// WIKI API ROUTER — bypasses Cloudflare by using the wiki's own JSON API
async function tryWikiApi(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const path = u.pathname;
    const wikiMatch = path.match(/^\/wiki\/(.+)$/);
    if (!wikiMatch) return null;

    const title = decodeURIComponent(wikiMatch[1]).replace(/_/g, ' ');

    // Fandom wikis (*.fandom.com)
    if (host.endsWith('.fandom.com')) {
      return await fetchMediaWikiApi(u.origin, title);
    }

    // Lexicanum (wh40k.lexicanum.com etc.)
    if (host.includes('lexicanum.com')) {
      return await fetchMediaWikiApi(u.origin, title);
    }

    // Wikipedia — use REST API (cleaner HTML)
    if (host.endsWith('wikipedia.org')) {
      const resp = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`,
        { headers: { 'Accept': 'text/html' } }
      );
      if (resp.ok) return await resp.text();
      return null;
    }

    // Any other /wiki/ site — try MediaWiki API speculatively
    return await fetchMediaWikiApi(u.origin, title, 4000);

  } catch(e) {
    return null;
  }
}

async function fetchMediaWikiApi(origin, title, timeoutMs = 10000) {
  try {
    const apiUrl = `${origin}/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text|displaytitle&format=json&origin=*`;
    const resp = await fetch(apiUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.parse || !data.parse.text) return null;

    const html = data.parse.text['*'];
    const pageTitle = data.parse.displaytitle || data.parse.title || title;
    return `<!DOCTYPE html>
<html>
<head><title>${esc(pageTitle)}</title><base href="${esc(origin)}"></head>
<body>
<h1 class="firstHeading">${pageTitle}</h1>
<div class="mw-parser-output">${html}</div>
</body>
</html>`;
  } catch(e) {
    return null;
  }
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
