export interface GermanExample {
  de: string;
  fa: string;
}

export const CURATED_GERMAN_EXAMPLES: readonly GermanExample[] = [
  {
    de: 'Ich möchte bitte zwei frische Brötchen kaufen.',
    fa: 'لطفاً می‌خواهم دو عدد نان تازه بخرم.',
  },
  {
    de: 'Entschuldigung, wie komme ich zum Hauptbahnhof?',
    fa: 'ببخشید، چطور می‌توانم به ایستگاه مرکزی قطار بروم؟',
  },
  {
    de: 'Das Wetter ist heute überraschend schön und sonnig.',
    fa: 'هوا امروز به‌طور غافلگیرکننده‌ای خوب و آفتابی است.',
  },
  {
    de: 'Könnten Sie das bitte etwas langsamer wiederholen?',
    fa: 'آیا ممکن است لطفاً آن را کمی آهسته‌تر تکرار کنید؟',
  },
];

export function normalizeTranslationResult(
  raw: Record<string, unknown>,
): string {
  const value = raw.translationFa;
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeExamplesResult(
  raw: Record<string, unknown>,
): GermanExample[] {
  const list = Array.isArray(raw.examples) ? raw.examples : [];
  const seen = new Set<string>();
  const normalized: GermanExample[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const de = typeof record.de === 'string' ? record.de.trim() : '';
    const fa = typeof record.fa === 'string' ? record.fa.trim() : '';
    if (!de || !fa) continue;

    const dedupeKey = de.toLocaleLowerCase('de-DE');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    normalized.push({ de, fa });
    if (normalized.length >= 4) break;
  }

  return normalized;
}
