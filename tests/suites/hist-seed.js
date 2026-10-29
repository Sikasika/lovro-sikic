// History review fixtures: same exercise across sessions, set types, incomplete sets, cardio, supersets.
const L = (s) => new Date(s).toISOString();
module.exports = {
  schemaVersion: 2, cardioExercisesAdded: true, active: null, bodyweights: [],
  settings: { unit: 'kg', rest: 90, theme: 'system', plateauWeeks: 6 },
  exercises: [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'pull', name: 'Pull-up', category: 'Back' }, { id: 'squat', name: 'Squat', category: 'Legs' },
    { id: 'run', name: 'Running', category: 'Cardio' }, { id: 'fly', name: 'Cable Fly', category: 'Chest' }, { id: 'dip', name: 'Dips', category: 'Chest' }],
  templates: [],
  workouts: [
    { id: 'new', name: 'Push & Run', notes: 'Felt good', start: L('2026-10-27T18:00:00+01:00'), end: L('2026-10-27T19:10:00+01:00'),
      entries: [
        { exerciseId: 'bench', superset: 's1', note: 'Pause reps', sets: [{ weight: 40, reps: '10', done: true, type: 'warmup' }, { weight: 60, reps: '11', done: true }, { weight: 62.5, reps: '10', done: true, target: { weight: 62.5, reps: 8 } }, { weight: 40, reps: '12', done: true, type: 'drop' }] },
        { exerciseId: 'pull', superset: 's1', sets: [{ weight: '', reps: '9', done: true }, { weight: '', reps: '8', done: false }] },
        { exerciseId: 'dip', sets: [{ weight: '', reps: '12', done: true }] },
        { exerciseId: 'fly', sets: [{ weight: 15, reps: '12', done: true }, { weight: 15, reps: '12', done: true }] },
        { exerciseId: 'run', sets: [{ weight: '', reps: '', distance: 5500, duration: 1560, done: true }] }] },
    { id: 'mid', name: 'Legs', notes: '', start: L('2026-10-24T10:00:00+02:00'), end: L('2026-10-24T11:00:00+02:00'),
      entries: [{ exerciseId: 'squat', sets: [{ weight: 100, reps: '5', done: true }, { weight: 100, reps: '5', done: true }] }] },
    { id: 'old', name: 'Push', notes: '', start: L('2026-10-20T18:00:00+02:00'), end: L('2026-10-20T19:00:00+02:00'),
      entries: [
        { exerciseId: 'bench', sets: [{ weight: 40, reps: '10', done: true, type: 'warmup' }, { weight: 60, reps: '10', done: true }, { weight: 60, reps: '10', done: true }, { weight: 60, reps: '8', done: true }, { weight: 40, reps: '12', done: true, type: 'drop' }] },
        { exerciseId: 'pull', sets: [{ weight: 10, reps: '6', done: true }] },
        { exerciseId: 'dip', sets: [{ weight: '', reps: '12', done: true }] },
        { exerciseId: 'run', sets: [{ weight: '', reps: '', distance: 5000, duration: 1500, done: true }] }] },
  ]
};
