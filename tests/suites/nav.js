// Navigation helper for the five-tab layout (Today, Train, Plans, Progress, History).
// Insights, Statistics, Body weight and the Overview sit under Progress; Settings opens
// from the gear on Today. go(page, id) reaches any of them by the same taps a person uses.
const UNDER_PROGRESS = ['progress', 'insights', 'statistics', 'body'];
async function go(page, t) {
  if (t === 'settings') {
    await page.click('.tabbar [data-tab=home]');
    await page.click('[data-action=open-settings]');
  } else if (UNDER_PROGRESS.includes(t)) {
    await page.click('.tabbar [data-tab=progress]');
    await page.click(`#view .subnav [data-tab=${t}]`);
  } else {
    await page.click(`.tabbar [data-tab=${t}]`);
  }
}
module.exports = { go };
