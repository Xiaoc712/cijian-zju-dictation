const data = require('../data/phonetics').entries;
function pronunciation(english) {
  if (/\s/u.test(english.trim())) return { phonetic: '', phoneticLabel: '' };
  const entry = data[english.trim().toLowerCase()];
  return entry ? { phonetic: entry.ipa, phoneticLabel: entry.label || '' } : { phonetic: '', phoneticLabel: '' };
}
module.exports = { pronunciation };
