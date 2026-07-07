const axios = require('axios');
const fs = require('fs');
const cheerio = require('cheerio');

(async () => {
  try {
    const res = await axios.get('https://jkanime.net', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    fs.writeFileSync('jkanime_test.html', res.data);
    const $ = cheerio.load(res.data);
    
    console.log("JKANIME LINKS:");
    const links = [];
    $('a').each((i, el) => {
       const href = $(el).attr('href');
       // look for episode links like https://jkanime.net/anime-name/1/
       if (href && href.match(/\/\d+\/?$/) && href.includes('jkanime.net')) {
          links.push(href);
       }
    });
    // Print unique matching links
    console.log([...new Set(links)].slice(0, 5));

  } catch (e) {
    console.log('JKAnime error:', e.message);
  }

  try {
    const res = await axios.get('https://animeav1.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    fs.writeFileSync('animeav1_test.html', res.data);
    const $ = cheerio.load(res.data);
    
    console.log("ANIMEAV1 LINKS:");
    const links = [];
    $('a').each((i, el) => {
       const href = $(el).attr('href');
       if (href && href.includes('episodio')) {
          links.push(href);
       }
    });
    console.log([...new Set(links)].slice(0, 5));
  } catch (e) {
    console.log('AnimeAV1 error:', e.message);
  }
})();
