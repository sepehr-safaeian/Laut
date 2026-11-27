import type {
  AnalyzedWord,
  IssueSeverity,
  PhoneticIssue,
  PronunciationAnalysis,
  WordStatus,
} from '../types/pronunciation';

const VALID_WORD_STATUSES: ReadonlySet<WordStatus> = new Set([
  'accurate',
  'imprecise',
  'mispronounced',
  'omitted',
]);

const VALID_SEVERITIES: ReadonlySet<IssueSeverity> = new Set([
  'mispronounced',
  'omitted',
  'imprecise',
]);

/**
 * Splits a German sentence into display tokens while keeping attached punctuation.
 */
export function tokenizeGermanText(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Strips leading/trailing punctuation from a German word for comparison or single-word TTS.
 */
export function stripWordPunctuation(token: string): string {
  return token.replace(/^[\s.,!?;:„“"‚‘'()[\]{}–—-]+|[\s.,!?;:„“"‚‘'()[\]{}–—-]+$/g, '');
}

function normalizeForMatch(token: string): string {
  return stripWordPunctuation(token).toLocaleLowerCase('de-DE');
}

/**
 * Aligns model-returned word statuses with the exact tokens of the user's target sentence
 * so the rendered sentence always preserves the user's exact spelling and punctuation.
 */
export function alignWordsWithTarget(
  targetText: string,
  modelWords: ReadonlyArray<{ word?: unknown; status?: unknown }> | undefined,
): AnalyzedWord[] {
  const targetTokens = tokenizeGermanText(targetText);
  if (targetTokens.length === 0) return [];

  const sanitizedModel: AnalyzedWord[] = (modelWords ?? [])
    .filter((entry): entry is { word: string; status: WordStatus } => {
      return (
        typeof entry?.word === 'string' &&
        entry.word.trim().length > 0 &&
        typeof entry?.status === 'string' &&
        VALID_WORD_STATUSES.has(entry.status as WordStatus)
      );
    })
    .map((entry) => ({
      word: entry.word.trim(),
      status: entry.status,
    }));

  if (sanitizedModel.length === 0) {
    return targetTokens.map((word) => ({ word, status: 'accurate' }));
  }

  let cursor = 0;
  return targetTokens.map((token, index) => {
    const normalizedTarget = normalizeForMatch(token);

    // Search in a small forward window for an exact normalized match
    const windowEnd = Math.min(sanitizedModel.length, cursor + 4);
    for (let i = cursor; i < windowEnd; i++) {
      if (normalizeForMatch(sanitizedModel[i].word) === normalizedTarget) {
        cursor = i + 1;
        return { word: token, status: sanitizedModel[i].status };
      }
    }

    // Fallback to positional alignment if counts match closely
    if (index < sanitizedModel.length) {
      cursor = Math.max(cursor, index + 1);
      return { word: token, status: sanitizedModel[index].status };
    }

    return { word: token, status: 'omitted' };
  });
}

export interface HighlightedWordParts {
  before: string;
  match: string;
  after: string;
}

/**
 * Finds the exact contiguous problem letters inside a German word (case-insensitive, German locale)
 * and returns three safe plain-text segments for rendering without raw HTML.
 */
export function highlightProblemSubstring(
  word: string,
  problemSubstring: string,
): HighlightedWordParts {
  const cleanWord = word.trim();
  const cleanSub = problemSubstring.trim();

  if (!cleanWord || !cleanSub) {
    return { before: cleanWord, match: '', after: '' };
  }

  const lowerWord = cleanWord.toLocaleLowerCase('de-DE');
  const lowerSub = cleanSub.toLocaleLowerCase('de-DE');

  const idx = lowerWord.indexOf(lowerSub);
  if (idx === -1) {
    return { before: cleanWord, match: '', after: '' };
  }

  return {
    before: cleanWord.slice(0, idx),
    match: cleanWord.slice(idx, idx + cleanSub.length),
    after: cleanWord.slice(idx + cleanSub.length),
  };
}

/**
 * Sanitizes and normalizes the raw JSON returned by Gemini into a reliable PronunciationAnalysis.
 */
export function normalizeAnalysisResult(
  targetText: string,
  raw: Record<string, unknown>,
): PronunciationAnalysis {
  const speechDetected =
    typeof raw.speechDetected === 'boolean' ? raw.speechDetected : true;

  const rawScore =
    typeof raw.overallScore === 'number' && Number.isFinite(raw.overallScore)
      ? Math.round(raw.overallScore)
      : 0;
  const overallScore = speechDetected
    ? Math.max(0, Math.min(100, rawScore))
    : 0;

  const words = speechDetected
    ? alignWordsWithTarget(
        targetText,
        Array.isArray(raw.words) ? raw.words : undefined,
      )
    : tokenizeGermanText(targetText).map((word) => ({
        word,
        status: 'omitted' as const,
      }));

  const rawIssues = Array.isArray(raw.issues) ? raw.issues : [];
  const issues: PhoneticIssue[] = speechDetected
    ? rawIssues
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => {
          const severity: IssueSeverity =
            typeof item.severity === 'string' &&
            VALID_SEVERITIES.has(item.severity as IssueSeverity)
              ? (item.severity as IssueSeverity)
              : 'mispronounced';

          const word =
            typeof item.word === 'string'
              ? stripWordPunctuation(item.word.trim())
              : '';
          const problemSubstring =
            typeof item.problemSubstring === 'string'
              ? item.problemSubstring.trim()
              : '';
          const ipaTarget =
            typeof item.ipaTarget === 'string' ? item.ipaTarget.trim() : '';
          const explanationFa =
            typeof item.explanationFa === 'string'
              ? item.explanationFa.trim()
              : '';

          return {
            word,
            problemSubstring,
            severity,
            ipaTarget,
            explanationFa,
          };
        })
        .filter((issue) => issue.word.length > 0 && issue.explanationFa.length > 0)
    : [];

  return {
    overallScore,
    speechDetected,
    words,
    issues,
  };
}

export function isPerfectPronunciation(analysis: PronunciationAnalysis): boolean {
  return (
    analysis.speechDetected &&
    analysis.overallScore >= 95 &&
    analysis.issues.length === 0
  );
}

export function getErrorTagFa(severity: IssueSeverity): string {
  switch (severity) {
    case 'omitted':
      return 'حذف شده';
    case 'imprecise':
      return 'نیاز به دقت بیشتر';
    case 'mispronounced':
    default:
      return 'تلفظ اشتباه';
  }
}

export function getWordStatusLabelFa(status: WordStatus): string {
  switch (status) {
    case 'accurate':
      return 'دقیق';
    case 'imprecise':
      return 'نیاز به دقت بیشتر';
    case 'omitted':
      return 'حذف شده';
    case 'mispronounced':
    default:
      return 'تلفظ اشتباه';
  }
}

export function formatElapsedSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export const MIN_RECORDING_MS = 450;
export const MIN_PEAK_RMS = 0.008;

export function isRecordingUsable(params: {
  durationMs: number;
  peakRms: number;
  byteSize: number;
}): { ok: true } | { ok: false; reason: 'too_short' | 'silent' | 'empty' } {
  if (params.byteSize < 256) {
    return { ok: false, reason: 'empty' };
  }
  if (params.durationMs < MIN_RECORDING_MS) {
    return { ok: false, reason: 'too_short' };
  }
  if (params.peakRms < MIN_PEAK_RMS) {
    return { ok: false, reason: 'silent' };
  }
  return { ok: true };
}
