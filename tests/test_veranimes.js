const axios = require('axios');
const cheerio = require('cheerio');

function formatServerName(span1, title) {
  if (title && typeof title === 'string' && title.trim()) {
    const t = title.trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  if (span1 && typeof span1 === 'string' && span1.trim()) {
    const clean = span1.replace(/\s*\d+$/, '').trim();
    return clean
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return 'Unknown';
}

async function testExtraction(slug, ep) {
  const url = 'https://wwv.veranimes.net/ver/' + slug + '-' + ep;
  const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const $ = cheerio.load(res.data);
  const enc = $('ul.opt[data-encrypt]').attr('data-encrypt');

  const postRes = await axios.post('https://wwv.veranimes.net/process', 'acc=opt&i=' + enc, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0',
      'Referer': url
    }
  });

  const $opt = cheerio.load('<ul>' + postRes.data + '</ul>');
  const allList = [];
  $opt('li').each((i, el) => {
    const hex = $opt(el).attr('encrypt');
    const title = $opt(el).attr('title');
    const span1 = $opt(el).find('span').eq(0).text().trim();
    const serverName = formatServerName(span1, title);
    const serverUrl = Buffer.from(hex, 'hex').toString('utf8');
    allList.push({ server: serverName, url: serverUrl });
  });

  // Dedup by server + url (or server name)
  const seen = new Set();
  const deduped = [];
  for (const item of allList) {
    const key = `${item.server}|${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  console.log(`\n=== Result for ${slug}-${ep} (Total: ${deduped.length} servers) ===`);
  console.table(deduped);
}

async function main() {
  await testExtraction('toshokan-sensou', 1);
  await testExtraction('mebius-dust', 8);
  await testExtraction('bang-dream-yumemita', 11);
}

main().catch(console.error);
