const cheerio = require('cheerio');
const axios = require('axios');

(async () => {
    try {
        const jReq = await axios.get('https://jkanime.net', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $j = cheerio.load(jReq.data);
        console.log('JKAnime sections with episodes:');
        
        $j('.maximoaltura').each((i, el) => {
           console.log('Found .maximoaltura', $j(el).find('a').length, 'links');
        });
        $j('.bloque, .container, section').each((i, el) => {
           const html = $j(el).html() || '';
           if (html.includes('PROGRAMACIÓN')) {
               console.log('Found PROGRAMACION container class:', $j(el).attr('class'));
           }
        });
    } catch(e) { console.log('jkanime error', e.message); }

    try {
        const mReq = await axios.get('https://monoschinos2.com', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $m = cheerio.load(mReq.data);
        console.log('\nMonosChinos sections:');
        $m('.container, section, .row').each((i, el) => {
           const html = $m(el).html() || '';
           if (html.includes('Últimos capítulos') || html.includes('Ultimos capitulos')) {
               console.log('Found Ultimos Capitulos container class:', $m(el).attr('class'));
           }
        });
    } catch(e) { console.log('monoschinos error', e.message); }
})();
