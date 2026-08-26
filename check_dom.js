const fs = require('fs');
const cheerio = require('cheerio');
const $ = cheerio.load(fs.readFileSync('jkanime_source.html', 'utf8'));

// find where PROGRAMACION is
const prog = $('*:contains("PROGRAMACIÓN")').last();
console.log('JKAnime - Programacion container:', prog.parent().parent().attr('class'));

// list classes of episodes
const eps = [];
$('a').each((i, el) => {
   const href = $(el).attr('href');
   if(href && href.match(/\/\d+\/?$/) && href.includes('jkanime')) {
      const cls = $(el).attr('class');
      const pcls = $(el).parent().attr('class');
      const ppcls = $(el).parent().parent().attr('class');
      const pppcls = $(el).parent().parent().parent().attr('class');
      eps.push({ href, class: cls, pcls, ppcls, pppcls });
   }
});
console.log('JKAnime first ep:', eps[0]);
console.log('JKAnime last ep:', eps[eps.length-1]);

const $m = cheerio.load(fs.readFileSync('monoschinos_source.html', 'utf8'));
const meps = [];
$m('a[href*="-episodio-"]').each((i, el) => {
   const href = $m(el).attr('href');
   const cls = $m(el).attr('class');
   const pcls = $m(el).parent().attr('class');
   const ppcls = $m(el).parent().parent().attr('class');
   const pppcls = $m(el).parent().parent().parent().attr('class');
   meps.push({ href, class: cls, pcls, ppcls, pppcls });
});
console.log('MonosChinos first ep:', meps[0]);
console.log('MonosChinos last ep:', meps[meps.length-1]);

