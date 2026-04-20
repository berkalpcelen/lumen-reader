export default async function handler(req, res) {
  // Allow from any origin (our own frontend)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(url);
    new URL(targetUrl); // validate
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Block non-http and private IPs (basic SSRF protection)
  if (!/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: 'Only http/https URLs allowed' });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        // Mimic a real browser so sites don't block us
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Referer': new URL(targetUrl).origin + '/',
      },
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || 'text/html';
    const html = await response.text();

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Final-Url', response.url || targetUrl);
    res.status(200).send(html);
  } catch (err) {
    res.status(502).json({ error: 'Fetch failed: ' + err.message });
  }
}
