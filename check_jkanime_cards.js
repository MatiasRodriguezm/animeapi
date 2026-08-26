const fs = require('fs');
const cheerio = require('cheerio');
const axios = require('axios');

(async () => {
  try {
    let html;
    if (fs.existsSync('jkanime_source.html')) {
      html = fs.readFileSync('jkanime_source.html', 'utf8');
    } else {
      const res = await axios.get('https://jkanime.net', { headers: { 'User-Agent': 'Mozilla/5.0' } });
      html = res.data;
    }
    const $ = cheerio.load(html);

    console.log("=== JKANIME CARD HTML SAMPLES ===");
    $('.card, .anime__item, [class*="dir1"], .hero__items').slice(0, 4).each((i, el) => {
      console.log(`--- Element ${i} (class: ${$(el).attr('class')}) ---`);
      console.log($(el).html());
    });

    console.log("\n=== ALL A TAGS IN .row.mode1.autoimage or similar ===");
    $('.row.mode1.autoimage, .row-cols-md-3').find('a').slice(0, 6).each((i, el) => {
      console.log(`Link ${i}: href=${$(el).attr('href')}, class=${$(el).attr('class')}, html=${$(el).html()}`);
    });

  } catch (e) {
    console.error(e);
  }
})();
