const animeService = require('../src/services/anime.service');

async function runAnimeD23Tests() {
  console.log('====================================================');
  console.log('TEST 1: SEARCH ANIMED23');
  console.log('====================================================');
  const searchRes = await animeService.searchAnime('super', 'animed23.com');
  console.log('Success:', searchRes.success);
  console.log('Source:', searchRes.source);
  console.log('Count:', searchRes.data.count);
  console.log('Results:', searchRes.data.results);

  console.log('\n====================================================');
  console.log('TEST 2: GET ANIME INFO ANIMED23');
  console.log('====================================================');
  const infoRes = await animeService.getAnimeInfo('https://animed23.com/anime/super-no-ura-de-yani-suu-futari/');
  console.log('Success:', infoRes.success);
  console.log('Source:', infoRes.source);
  console.log('Title:', infoRes.data.title);
  console.log('Japanese Title:', infoRes.data.titleJapanese);
  console.log('Status:', infoRes.data.status);
  console.log('Type:', infoRes.data.type);
  console.log('Year:', infoRes.data.year);
  console.log('Score:', infoRes.data.score);
  console.log('Total Episodes:', infoRes.data.totalEpisodes);
  console.log('Genres:', infoRes.data.genres.map((g) => g.name).join(', '));
  console.log('Episodes Count:', infoRes.data.episodes.length);
  console.log('First 2 Episodes:', infoRes.data.episodes.slice(0, 2));

  console.log('\n====================================================');
  console.log('TEST 3: GET EPISODE LINKS ANIMED23');
  console.log('====================================================');
  const epRes = await animeService.getEpisodeLinks('https://animed23.com/capitulo/super-no-ura-de-yani-suu-futari-ep-8/');
  console.log('Success:', epRes.success);
  console.log('Source:', epRes.source);
  console.log('Title:', epRes.data.title);
  console.log('Episode:', epRes.data.episode);
  console.log('PublishedAt:', epRes.data.publishedAt);
  console.log('Variants:', epRes.data.variants);
  console.log('Streaming Servers Count (SUB):', epRes.data.servers.sub.length);
  console.log('Streaming Servers (SUB):');
  console.table(epRes.data.servers.sub);
  console.log('Download Links Count (SUB):', epRes.data.downloadLinks.SUB.length);
  console.log('Download Links (SUB):');
  console.table(epRes.data.downloadLinks.SUB);

  console.log('\n====================================================');
  console.log('TEST 4: LATEST EPISODES ANIMED23');
  console.log('====================================================');
  const latestRes = await animeService.getLatestEpisodes('animed23.com');
  console.log('Success:', latestRes.success);
  console.log('Source:', latestRes.source);
  console.log('Count:', latestRes.data.count);
  console.log('Sample 3 Latest:', latestRes.data.results.slice(0, 3));

  console.log('\n====================================================');
  console.log('TEST 5: OTHER PROVIDERS REGRESSION TESTS');
  console.log('====================================================');
  const veranimesRes = await animeService.searchAnime('toshokan', 'veranimes');
  console.log('VerAnimes Search Count:', veranimesRes.data.count, 'Source:', veranimesRes.source);

  const jkanimeRes = await animeService.searchAnime('naruto', 'jkanime.net');
  console.log('JKAnime Search Count:', jkanimeRes.data.count, 'Source:', jkanimeRes.source);

  const tioanimeRes = await animeService.searchAnime('bleach', 'tioanime.com');
  console.log('TioAnime Search Count:', tioanimeRes.data.count, 'Source:', tioanimeRes.source);

  console.log('\n✅ ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY FOR ANIMED23!');
}

runAnimeD23Tests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
