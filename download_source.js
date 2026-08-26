const axios = require('axios');
const fs = require('fs');

(async () => {
    try {
        const jReq = await axios.get('https://jkanime.net', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        fs.writeFileSync('jkanime_source.html', jReq.data);
    } catch(e) {}
    try {
        const mReq = await axios.get('https://monoschinos2.com', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        fs.writeFileSync('monoschinos_source.html', mReq.data);
    } catch(e) {}
})();
