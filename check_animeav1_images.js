const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
  try {
    const res = await axios.get('https://animeav1.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    const html = res.data;
    const $ = cheerio.load(html);

    console.log("=== SAMPLES OF A TAGS MATCHING /media/ ===");
    $('a[href*="/media/"]').slice(0, 5).each((i, el) => {
      console.log(`--- Element ${i} ---`);
      console.log('href:', $(el).attr('href'));
      console.log('class:', $(el).attr('class'));
      console.log('html:', $(el).html());
      console.log('parent html:', $(el).parent().html().slice(0, 300));
    });

    console.log("\n=== CHECKING ALL IMG TAGS IN PAGE ===");
    $('img').slice(0, 10).each((i, el) => {
      console.log(`img ${i}: src=${$(el).attr('src')}, data-src=${$(el).attr('data-src')}, srcset=${$(el).attr('srcset')}, parent=${$(el).parent().prop('tagName')}`);
    });

    console.log("\n=== CHECKING SVELTE / JSON SCRIPT TAGS ===");
    $('script').each((i, el) => {
      const content = $(el).html() || '';
      if (content.includes('media/') || content.includes('episodes') || content.includes('poster') || content.includes('cover')) {
        console.log(`Script ${i} length: ${content.length}, preview: ${content.slice(0, 200)}`);
      }
    });

  } catch(e) {
    console.error(e);
  }
})();
