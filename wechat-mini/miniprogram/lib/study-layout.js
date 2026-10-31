// The question and answer controls occupy separate native scroll views.
// Neither keyboard focus nor scrolling the answers can scroll the question's parent.
function studyLayout(height, safeBottom = 0, questionContentHeight = 128) {
  const available = Math.max(0, Number.isFinite(height) ? height : 0);
  const navPadding = Number.isFinite(safeBottom) ? Math.min(50, Math.max(0, safeBottom)) : 0;
  const navHeight = (available < 300 ? 36 : 48) + navPadding;
  const cardHeight = Math.max(0, available - navHeight - 16);
  // Border + padding (10), header (32), question margins (6), progress (2).
  const usable = Math.max(0, cardHeight - 50);
  const content = Number.isFinite(questionContentHeight) && questionContentHeight > 0 ? questionContentHeight : 128;
  const questionHeight = Math.min(220, Math.max(40, content), Math.max(40, Math.round(usable * .42)), usable);
  return {
    studyCardHeight: cardHeight,
    studyQuestionHeight: questionHeight,
    studyControlsHeight: Math.max(0, usable - questionHeight),
    studyNavTop: Math.max(0, available - navHeight),
    studyNavHeight: navHeight,
    studyNavPadding: navPadding,
    shortStage: available < 340
  };
}
module.exports = { studyLayout };
