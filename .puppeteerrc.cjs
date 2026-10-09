const { join } = require("path");

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Store Chrome inside project folder to ensure availability on Render
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
