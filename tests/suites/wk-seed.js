const L = (s) => new Date(s).toISOString();
module.exports = {
  schemaVersion: 2, cardioExercisesAdded: true, active: null, settings: { unit: 'kg', rest: 90, theme: 'system', plateauWeeks: 6 },
  exercises: [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'row', name: 'Barbell Row', category: 'Back' }, { id: 'squat', name: 'Squat', category: 'Legs' },
    { id: 'run', name: 'Running', category: 'Cardio' }, { id: 'fly', name: 'Cable Fly', category: 'Chest' }, { id: 'tennis', name: 'Tennis', category: 'Sports' }],
  templates: [
    { id: 't1', name: 'Push Day', location: 'City Gym', entries: [
      { exerciseId: 'bench', note: 'Pause at bottom', sets: [{ weight: 40, reps: 10, type: 'warmup' }, { weight: 80, reps: 5 }, { weight: 80, reps: 5 }, { weight: 80, reps: 5 }, { weight: 60, reps: 8, type: 'drop' }] },
      { exerciseId: 'fly', superset: 'ss1', sets: [{ weight: 15, reps: 12 }, { weight: 15, reps: 12 }] },
      { exerciseId: 'row', superset: 'ss1', sets: [{ weight: 60, reps: 10 }, { weight: 60, reps: 10 }] }] },
    { id: 't2', name: 'Legs', entries: [{ exerciseId: 'squat', sets: 3 }] },
    { id: 't3', name: 'Easy Run', entries: [{ exerciseId: 'run', sets: [{ distance: 5000, duration: 1800 }] }] }],
  workouts: [
    { id: 'w1', name: 'Push Day', location: 'City Gym', templateId: 't1', notes: '', start: L('2026-10-26T18:00:00'), end: L('2026-10-26T19:05:00'),
      entries: [{ exerciseId: 'bench', note: 'Felt strong', sets: [{ weight: 40, reps: '10', done: true, type: 'warmup' }, { weight: 77.5, reps: '5', done: true }, { weight: 77.5, reps: '5', done: true }, { weight: 77.5, reps: '4', done: true }] },
        { exerciseId: 'fly', sets: [{ weight: 12.5, reps: '12', done: true }, { weight: 12.5, reps: '12', done: true }] }] },
    { id: 'w2', name: 'Morning Run', location: '', notes: '', start: L('2026-10-24T08:00:00'), end: L('2026-10-24T08:35:00'),
      entries: [{ exerciseId: 'run', sets: [{ weight: '', reps: '', distance: 5200, duration: 1850, done: true }] }] },
    { id: 'w3', name: 'Legs', location: 'Home', notes: '', start: L('2026-10-22T18:00:00'), end: L('2026-10-22T19:00:00'),
      entries: [{ exerciseId: 'squat', sets: [{ weight: 100, reps: '5', done: true }, { weight: 100, reps: '5', done: true }, { weight: 100, reps: '5', done: true }] }] }]
};
