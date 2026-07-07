const axios = require('axios');
const fs = require('fs');

(async () => {
  const providers = {
    'tioanime': 'https://tioanime.com',
    'monoschinos': 'https://monoschinos2.com',
    'jkanime': 'https://jkanime.net',
    'animeav1': 'https://animeav1.com'
  };
  
  for (const [name, url] of Object.entries(providers)) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      fs.writeFileSync(`${name}.html`, res.data);
      console.log(`Saved ${name}.html`);
    } catch(e) {
      console.log(url, e.message);
    }
  }
})();
