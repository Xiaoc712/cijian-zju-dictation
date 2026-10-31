// Match the two fixed-width columns while keeping each English word unbroken.
function englishFontSize(english, viewportWidth = 393) {
  const width = Math.min(850, Math.min(1100, viewportWidth) - (viewportWidth >= 800 ? 64 : viewportWidth < 350 ? 30 : 40));
  const textWidth = Math.max(35, (width - 23 - 12 - 8) / 2 - 12);
  const emWidth = token => [...token].reduce((sum, char) => sum + (/[iljtfI.'’]/.test(char) ? 0.34 : /[mwMW]/.test(char) ? 0.9 : /[A-Z]/.test(char) ? 0.74 : char === '-' ? 0.4 : 0.6), 0);
  const longest = Math.max(1, ...english.split(/\s+/).map(emWidth));
  return Math.floor(Math.min(viewportWidth >= 800 ? 22 : 18, textWidth / longest * 0.93) * 10) / 10;
}
module.exports = { englishFontSize };
