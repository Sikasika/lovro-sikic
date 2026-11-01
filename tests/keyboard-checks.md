# Keyboard checks on a real iPhone

The browser tests can't show the iOS keyboard. `node tests/kb-audit.js` only measures
where fields and buttons sit; it can't tell whether iOS scrolls them into view. These
checks need a real iPhone (ideally a small one such as an SE, and once in the Home Screen
app as well as in Safari).

## What the measurements show (v41, all widths, light and dark identical)

- Short sheets sit entirely in the bottom third: **Add Weigh-in** (285 px tall on a
  320 × 568 screen) and **Target weight** (254 px). A keyboard is about 300 px, so
  every field in them starts behind it. Their Save button is at the top of the sheet.
- Tall sheets (88% of the screen) can scroll most fields into view, except the last
  ones: **Edit Workout** notes, the last set rows of the **template editor**, **Max heart
  rate** (run plan setup), **Long ride on** (ride plan setup, a menu).
- Buttons at the bottom of a sheet (**Review Plan**, **Review Schedule**, **Save Workout**)
  are always under the keyboard while it is open; you close the keyboard to reach them.
- Live workout set fields already have their own handling (`keepFieldVisible`).

## Checks (each: tap the field, look, then tap Done)

1. Progress → Body → Other date: tap Weight, then Note. Is the field you type in visible
   above the keyboard? Is Save (top right) still visible?
2. Progress → Body → Set a target weight: tap both fields. Same questions.
3. Settings → Manage exercises → New: tap Name. Visible? Save visible?
4. Train → Templates → open a template with 2+ exercises: tap a weight in the last set of
   the last exercise. Visible, or hidden behind the keyboard?
5. History → a workout → Edit: tap Notes (bottom). Visible?
6. Plans → a plan → a session → Move to (date): does the date wheel cover the field or
   the Done button?
7. Plans → New → 5K plan: tap Max heart rate (last field). Visible? After Done, can you
   reach Review Plan?
8. Plans → New → Cycling plan: tap Long ride on (the last menu). Is the menu and the field visible?
9. Finish a workout that ran over 4 hours: tap Ended at. Does the time wheel cover the
   field or Save Workout?
10. During a workout: tap a set's weight in the last exercise. Does it stay above the
    keyboard (this is the case `keepFieldVisible` handles)?

For any "hidden" answer, note the iPhone model, Safari or Home Screen app, and whether
scrolling the sheet by hand reveals the field.
