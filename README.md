# parcijalni-ispit
To start the project:
   - run `npm install`, then `node app.js` in your terminal
   - go to `localhost:3000`

## Training Tracker (iPhone app)

`training-tracker/` is an installable web app (PWA) for logging workouts on iPhone.
It is served at `localhost:3000/training-tracker/` locally, and at `/training-tracker/`
on the Azure Static Web App once deployed.

**Install on iPhone:** open the URL in Safari → Share → **Add to Home Screen**.
It then launches full-screen like a native app and works offline.

Features:
- Start a workout, add exercises (29 built-in, or create your own), log weight × reps per set
- Check off sets to start a rest timer (default 90 s, adjustable)
- "Last time" values shown for each exercise; leave a field blank to reuse them
- History with workout details, volume, and "repeat this workout"
- Progress: workouts per week, weekly streak, and estimated 1-rep-max trend per exercise
- kg / lb, light / dark mode, JSON backup export and import

Data is stored only on the device (localStorage). Export a backup from Settings now and then.
