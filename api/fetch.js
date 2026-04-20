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

  const parsed = new URL(targetUrl);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9,en-US;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Referer': parsed.origin + '/',
        'Origin': parsed.origin,
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    const html = await response.text();

    // Detect Cloudflare challenge pages
    if (
      html.includes('Just a moment') ||
      html.includes('cf-browser-verification') ||
      html.includes('_cf_chl') ||
      html.includes('challenge-platform') ||
      response.status === 403 ||
      response.status === 503
    ) {
      // Try fetching via a Cloudflare-friendly mirror for known wikis
      const mirror = getWikiMirror(targetUrl);
      if (mirror) {
        const mirrorRes = await fetch(mirror, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-GB,en;q=0.9',
          },
          redirect: 'follow',
        });
        const mirrorHtml = await mirrorRes.text();
        if (!mirrorHtml.includes('Just a moment') && mirrorHtml.trim().startsWith('<')) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('X-Via-Mirror', 'true');
          return res.status(200).send(mirrorHtml);
        }
      }

      return res.status(403).json({
        error: 'cloudflare',
        message: 'This site uses Cloudflare bot protection and cannot be fetched automatically.',
        suggestion: getAlternative(targetUrl),
      });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Final-Url', response.url || targetUrl);
    return res.status(200).send(html);

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'timeout', message: 'Request timed out after 15 seconds.' });
    }
    return res.status(502).json({ error: 'fetch_failed', message: err.message });
  }
}

// For Fandom/Lexicanum wikis, try their API which bypasses Cloudflare
function getWikiMirror(url) {
  try {
    const u = new URL(url);

    // Fandom: warhammer40k.fandom.com/wiki/PageName
    // → use Fandom's public API
    if (u.hostname.endsWith('.fandom.com')) {
      const match = u.pathname.match(/^\/wiki\/(.+)$/);
      if (match) {
        const title = match[1];
        const wiki = u.hostname.replace('.fandom.com', '');
        return `https://services.fandom.com/wikis/${wiki}/articles/search?title=${encodeURIComponent(decodeURIComponent(title))}`;
      }
    }

    // Lexicanum: uses MediaWiki — try the raw API
    if (u.hostname.includes('lexicanum.com')) {
      const match = u.pathname.match(/^\/wiki\/(.+)$/);
      if (match) {
        const title = decodeURIComponent(match[1]);
        return `${u.origin}/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&origin=*`;
      }
    }

    return null;
  } catch(e) { return null; }
}

function getAlternative(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('fandom.com')) {
      const match = u.pathname.match(/^\/wiki\/(.+)$/);
      if (match) {
        const title = match[1];
        return `https://en.wikipedia.org/wiki/${title}`;
      }
    }
    if (u.hostname.includes('lexicanum.com')) {
      const match = u.pathname.match(/^\/wiki\/(.+)$/);
      if (match) {
        return `Try the Warhammer 40k Fandom wiki instead: https://warhammer40k.fandom.com/wiki/${match[1]}`;
      }
    }
    return null;
  } catch(e) { return null; }
}
