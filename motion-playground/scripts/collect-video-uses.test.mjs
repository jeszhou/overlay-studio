import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const { collectVideoUses, collectCameraIntervals } = await tsImport('./collect-video-uses.ts', {
  parentURL: import.meta.url,
  tsconfig: fileURLToPath(new URL('../tsconfig.app.json', import.meta.url)),
});

test('filenames displayed as card copy are not treated as video assets', () => {
  const job = { mode: 'timeline', duration: 6, doc: { cam: 'demo/talk.mp4', cards: [
    { kind: 'blur-text', start: 0, end: 2, params: { text: 'demo.mp4' } },
    { kind: 'focus-card', start: 2, end: 4, params: { title: 'recording.mov' } },
  ] } };
  assert.deepEqual([...collectVideoUses(job)], [['demo/talk.mp4', 4]]);
  assert.deepEqual([...collectCameraIntervals(job)], [['demo/talk.mp4', [[1.95, 4]]]]);
});
