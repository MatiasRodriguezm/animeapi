const animeService = require('../src/services/anime.service');

async function testAll() {
  const urls = [
    'https://veranimes.net/toshokan-sensou-1',
    'https://veranimes.net/ver/toshokan-sensou-1',
    'https://www.veranimes.net/ver/toshokan-sensou-1',
    'https://wwv.veranimes.net/ver/toshokan-sensou-1'
  ];

  for (const u of urls) {
    console.log(`\n=================================================`);
    console.log(`Testing URL: ${u}`);
    console.log(`=================================================`);
    const res = await animeService.getEpisodeLinks(u);
    console.log('Success:', res.success);
    console.log('Title:', res.data.title);
    console.log('Episode:', res.data.episode);
    console.log('Variants:', res.data.variants);
    console.log('Streaming Servers Count:', res.data.servers.sub.length);
    console.log('Download Links Count:', res.data.downloadLinks.SUB.length);
    console.log('Servers list:');
    console.table(res.data.servers.sub.map((s, idx) => ({ '#': idx + 1, server: s.server, url: s.url.slice(0, 45) })));
  }
}

testAll().catch(console.error);
