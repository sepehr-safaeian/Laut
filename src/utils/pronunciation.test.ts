import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignWordsWithTarget,
  formatElapsedSeconds,
  getErrorTagFa,
  highlightProblemSubstring,
  isPerfectPronunciation,
  isRecordingUsable,
  normalizeAnalysisResult,
  stripWordPunctuation,
  tokenizeGermanText,
} from './pronunciation';
import {
  ensureWavBytes,
  isRiffWav,
  parseSampleRateFromMimeType,
  wrapPcmAsWav,
} from './audioWav';

test('tokenizeGermanText splits German sentences preserving umlauts and punctuation', () => {
  assert.deepEqual(
    tokenizeGermanText('  Ich möchte   zwei Brötchen, bitte! '),
    ['Ich', 'möchte', 'zwei', 'Brötchen,', 'bitte!'],
  );
  assert.deepEqual(tokenizeGermanText('   '), []);
});

test('stripWordPunctuation removes surrounding German quotes and punctuation', () => {
  assert.equal(stripWordPunctuation('„Brötchen!“'), 'Brötchen');
  assert.equal(stripWordPunctuation('Straße,'), 'Straße');
  assert.equal(stripWordPunctuation('U-Bahn.'), 'U-Bahn');
});

test('alignWordsWithTarget aligns model statuses to exact target tokens including umlauts', () => {
  const target = 'Ich möchte bitte zwei Brötchen.';
  const aligned = alignWordsWithTarget(target, [
    { word: 'Ich', status: 'accurate' },
    { word: 'möchte', status: 'imprecise' },
    { word: 'bitte', status: 'accurate' },
    { word: 'zwei', status: 'accurate' },
    { word: 'Brötchen', status: 'mispronounced' },
  ]);

  assert.deepEqual(aligned, [
    { word: 'Ich', status: 'accurate' },
    { word: 'möchte', status: 'imprecise' },
    { word: 'bitte', status: 'accurate' },
    { word: 'zwei', status: 'accurate' },
    { word: 'Brötchen.', status: 'mispronounced' },
  ]);
});

test('alignWordsWithTarget handles omitted trailing words safely', () => {
  const aligned = alignWordsWithTarget('Guten Morgen zusammen', [
    { word: 'Guten', status: 'accurate' },
  ]);
  assert.deepEqual(aligned, [
    { word: 'Guten', status: 'accurate' },
    { word: 'Morgen', status: 'omitted' },
    { word: 'zusammen', status: 'omitted' },
  ]);
});

test('highlightProblemSubstring isolates umlauts and digraphs case-insensitively', () => {
  assert.deepEqual(highlightProblemSubstring('Brötchen', 'ö'), {
    before: 'Br',
    match: 'ö',
    after: 'tchen',
  });
  assert.deepEqual(highlightProblemSubstring('Ich', 'CH'), {
    before: 'I',
    match: 'ch',
    after: '',
  });
  assert.deepEqual(highlightProblemSubstring('Straße', 'xyz'), {
    before: 'Straße',
    match: '',
    after: '',
  });
});

test('normalizeAnalysisResult clamps score, filters invalid issues, and handles silent speech', () => {
  const normal = normalizeAnalysisResult('Ich gehe.', {
    overallScore: 108.4,
    speechDetected: true,
    words: [
      { word: 'Ich', status: 'accurate' },
      { word: 'gehe', status: 'accurate' },
    ],
    issues: [],
  });
  assert.equal(normal.overallScore, 100);
  assert.equal(isPerfectPronunciation(normal), true);

  const silent = normalizeAnalysisResult('Ich gehe.', {
    overallScore: 42,
    speechDetected: false,
    words: [],
    issues: [{ word: 'Ich', problemSubstring: 'ch', severity: 'mispronounced', ipaTarget: '/ɪç/', explanationFa: 'x' }],
  });
  assert.equal(silent.overallScore, 0);
  assert.equal(silent.speechDetected, false);
  assert.equal(silent.issues.length, 0);
  assert.equal(silent.words.every((w) => w.status === 'omitted'), true);
});

test('getErrorTagFa maps severities to concise Persian labels', () => {
  assert.equal(getErrorTagFa('mispronounced'), 'تلفظ اشتباه');
  assert.equal(getErrorTagFa('omitted'), 'حذف شده');
  assert.equal(getErrorTagFa('imprecise'), 'نیاز به دقت بیشتر');
});

test('formatElapsedSeconds and isRecordingUsable handle timer and recording edge cases', () => {
  assert.equal(formatElapsedSeconds(0), '00:00');
  assert.equal(formatElapsedSeconds(65), '01:05');

  assert.deepEqual(isRecordingUsable({ durationMs: 200, peakRms: 0.1, byteSize: 4000 }), {
    ok: false,
    reason: 'too_short',
  });
  assert.deepEqual(isRecordingUsable({ durationMs: 1200, peakRms: 0.001, byteSize: 4000 }), {
    ok: false,
    reason: 'silent',
  });
  assert.deepEqual(isRecordingUsable({ durationMs: 1200, peakRms: 0.05, byteSize: 4000 }), {
    ok: true,
  });
});

import {
  CURATED_GERMAN_EXAMPLES,
  normalizeExamplesResult,
  normalizeTranslationResult,
} from './studyHelpers';

test('ensureWavBytes wraps raw PCM with RIFF header and leaves valid WAV intact', () => {
  const pcm = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(isRiffWav(pcm), false);

  const wrapped = ensureWavBytes(pcm, 'audio/L16;codec=pcm;rate=24000');
  assert.equal(isRiffWav(wrapped), true);
  assert.equal(wrapped.byteLength, 44 + pcm.byteLength);

  const doubleWrapped = ensureWavBytes(wrapped, 'audio/wav');
  assert.equal(doubleWrapped.byteLength, wrapped.byteLength);
  assert.equal(parseSampleRateFromMimeType('audio/L16;rate=16000'), 16000);
  assert.equal(wrapPcmAsWav(pcm, 24000).byteLength, 52);
});

test('studyHelpers provides curated examples and sanitizes translation/example payloads', () => {
  assert.equal(CURATED_GERMAN_EXAMPLES.length, 4);
  assert.equal(
    CURATED_GERMAN_EXAMPLES.every((item) => item.de.length > 0 && item.fa.length > 0),
    true,
  );

  assert.equal(
    normalizeTranslationResult({ translationFa: '  صبح بخیر  ' }),
    'صبح بخیر',
  );
  assert.equal(normalizeTranslationResult({}), '');

  const cleaned = normalizeExamplesResult({
    examples: [
      { de: 'Guten Morgen!', fa: 'صبح بخیر!' },
      { de: 'guten morgen!', fa: 'تکراری' },
      { de: '  ', fa: 'خالی' },
      { de: 'Wie geht es dir?', fa: 'حالت چطور است؟' },
    ],
  });
  assert.deepEqual(cleaned, [
    { de: 'Guten Morgen!', fa: 'صبح بخیر!' },
    { de: 'Wie geht es dir?', fa: 'حالت چطور است؟' },
  ]);
});
