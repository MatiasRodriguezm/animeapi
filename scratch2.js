const cheerio = require('cheerio');
const fs = require('fs');

const $ = cheerio.load(fs.readFileSync('tioanime.html', 'utf8'));
const eps = [];
$('.episodes li article.episode, ul.episodes li a').each((i, el) => {
  const url = $(el).attr('href') || $(el).find('a').attr('href');
  const title = $(el).find('h3.title').text().trim();
  const image = $(el).find('img').attr('src');
  eps.push({url, title, image});
});
console.log('TioAnime:', eps.slice(0,2));

const $m = cheerio.load(fs.readFileSync('monoschinos.html', 'utf8'));
const meps = [];
$m('a[href*="-episodio-"]').each((i, el) => {
  const a = $m(el);
  meps.push({
    url: a.attr('href'),
    title: a.find('.title, h2, h3, p').text().trim() || a.text().trim(),
    image: a.find('img').attr('data-src') || a.find('img').attr('src')
  });
});
console.log('MonosChinos:', meps.slice(0,2));

const $j = cheerio.load(fs.readFileSync('jkanime.html', 'utf8'));
const jeps = [];
$j('.anime__sidebar__comment__item').each((i, el) => {
   const a = $j(el);
   const href = a.attr('href');
   if (href && href.match(/\/\d+\/$/)) {
      jeps.push({
         url: href,
         title: a.find('h5, .title').text().trim() || a.text().trim()
      });
   }
});
if (jeps.length === 0) {
    $j('a.list-group-item').each((i, el) => {
        const a = $j(el);
        jeps.push({
            url: a.attr('href'),
            title: a.text().trim()
        });
    });
}
console.log('JKAnime:', jeps.slice(0,2));

const $a = cheerio.load(fs.readFileSync('animeav1.html', 'utf8'));
const aeps = [];
$a('.list-episodes a, a[href*="/episodio/"]').each((i, el) => {
   const a = $a(el);
   aeps.push({
      url: a.attr('href'),
      title: a.text().trim(),
      image: a.find('img').attr('src')
   });
});
console.log('AnimeAV1:', aeps.slice(0,2));

