// Helpers for the redesigned Workout tab flow (start → review → begin; finish → summary sheet).
module.exports = (page) => {
  const settle = () => page.waitForTimeout(500); // the app ignores page taps for 450 ms after a screen change
  return {
    startEmpty: async () => { await page.click('[data-action=start-flow]'); await page.click('#sheet [data-action=start-empty]'); await settle(); },
    startTemplate: async (sel = '#view [data-action=review][data-kind=template]') => { await page.click(sel); await page.click('#sheet [data-action=begin]'); await settle(); },
    begin: async () => { await page.click('#sheet [data-action=begin]'); await settle(); },
    // Old behaviour of Finish: save ticked sets; with none ticked, discard.
    finish: async () => {
      await page.click('[data-action=finish]'); await page.waitForTimeout(150);
      if (await page.$('#sheet [data-action=save-workout]:not([data-include])')) await page.click('#sheet [data-action=save-workout]:not([data-include])');
      else { await page.click('#sheet [data-action=close-sheet]'); await page.click('#view [data-action=discard]'); }
      await settle();
    },
  };
};
