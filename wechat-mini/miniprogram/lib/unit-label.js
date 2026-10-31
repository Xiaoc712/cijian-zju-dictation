function unitTitle(unit) {
  const match = /^unit(\d+)(?:-(\d+))?\.csv$/i.exec(unit.id);
  return match ? 'Unit ' + match[1] + (match[2] ? '-' + match[2] : '') : unit.title;
}
module.exports = { unitTitle };
