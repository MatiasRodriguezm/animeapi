const fs = require('fs');
const cheerio = require('cheerio');
const $ = cheerio.load(fs.readFileSync('jkanime_source.html', 'utf8'));

console.log("=== Testing current vs fixed logic for JKAnime ===");

// Current logic:
const currentResults = [];
$("a").each((_, element) => {
  const a = $(element);
  const url = a.attr("href");
  if (url && url.match(/\/\d+\/?$/) && url.includes("jkanime")) {
    const title = a.find("h5, .title, p").text().trim() || a.text().trim();
    const image = a.find("img").attr("src");
    currentResults.push({ title, url, image });
  }
});
console.log("Current count before dedup:", currentResults.length);
const seen = new Set();
const currentDeduped = currentResults.filter(i => {
  if (seen.has(i.url)) return false;
  seen.add(i.url);
  return true;
});
console.log("Current count after dedup:", currentDeduped.length);
console.log("First 6 current items:", currentDeduped.slice(0, 6));

// Fixed logic (selecting only the programacion grid cards):
console.log("\n=== Proposed Fixed Logic ===");
const fixedResults = [];
$(".card.ml-2.mr-2 a, .row.mode1.autoimage a").each((_, element) => {
  const a = $(element);
  let url = a.attr("href");
  if (url && url.match(/\/\d+\/?$/)) {
    // Normalize URL by ensuring consistent trailing slash or removing it
    url = url.trim().replace(/\/+$/, "");
    const title = a.find("h5, .title, .card-title").text().trim() || a.text().trim();
    const imgEl = a.find("img");
    const image = imgEl.attr("data-animepic") || imgEl.attr("data-src") || imgEl.attr("src") || null;
    const number = url.split("/").pop();
    fixedResults.push({ title, url, image, number });
  }
});

const seenFixed = new Set();
const fixedDeduped = fixedResults.filter(i => {
  if (seenFixed.has(i.url)) return false;
  seenFixed.add(i.url);
  return true;
});
console.log("Fixed count:", fixedDeduped.length);
console.log("Fixed items sample:", fixedDeduped.slice(0, 5));
