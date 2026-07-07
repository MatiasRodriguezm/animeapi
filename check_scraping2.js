const fs = require('fs');
const cheerio = require('cheerio');
const $ = cheerio.load(fs.readFileSync('animeav1_test.html', 'utf8'));
const links = [];
$('a').each((i, el) => {
   const href = $(el).attr('href');
   if (href && !href.includes('javascript') && !href.includes('login') && !href.includes('register') && href.length > 2) {
      links.push(href);
   }
});
console.log([...new Set(links)].slice(0, 30));
