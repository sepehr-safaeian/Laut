import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Square, Volume2 } from 'lucide-react';
import {
  CURATED_GERMAN_EXAMPLES,
  type GermanExample,
} from '../utils/studyHelpers';

interface StudyAccordionsProps {
  targetText: string;
  disabled?: boolean;
  activeSpeechKey: string | null;
  loadingSpeechKey: string | null;
  onSpeakExample: (text: string, key: string) => void;
  onPracticeExample: (sentence: string) => void;
}

export function StudyAccordions({
  targetText,
  disabled = false,
  activeSpeechKey,
  loadingSpeechKey,
  onSpeakExample,
  onPracticeExample,
}: StudyAccordionsProps) {
  const trimmedText = targetText.trim();
  const hasText = trimmedText.length > 0;

  const [translationOpen, setTranslationOpen] = useState(false);
  const [translationFa, setTranslationFa] = useState<string | null>(null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const [examplesOpen, setExamplesOpen] = useState(false);
  const [examples, setExamples] = useState<readonly GermanExample[]>(
    CURATED_GERMAN_EXAMPLES,
  );
  const [examplesLoading, setExamplesLoading] = useState(false);
  const [examplesError, setExamplesError] = useState<string | null>(null);

  const translationCacheRef = useRef<Map<string, string>>(new Map());
  const examplesCacheRef = useRef<Map<string, GermanExample[]>>(new Map());
  const translationReqIdRef = useRef(0);
  const examplesReqIdRef = useRef(0);

  // Close panels cleanly when text changes so stale translations/examples never mismatch
  useEffect(() => {
    translationReqIdRef.current += 1;
    examplesReqIdRef.current += 1;
    setTranslationOpen(false);
    setTranslationLoading(false);
    setTranslationError(null);
    setTranslationFa(
      trimmedText ? (translationCacheRef.current.get(trimmedText) ?? null) : null,
    );

    setExamplesOpen(false);
    setExamplesLoading(false);
    setExamplesError(null);
    setExamples(
      trimmedText
        ? (examplesCacheRef.current.get(trimmedText) ?? [])
        : CURATED_GERMAN_EXAMPLES,
    );
  }, [trimmedText]);

  const loadTranslation = useCallback(async (source: string) => {
    const cached = translationCacheRef.current.get(source);
    if (cached) {
      setTranslationFa(cached);
      setTranslationError(null);
      return;
    }

    const reqId = ++translationReqIdRef.current;
    setTranslationLoading(true);
    setTranslationError(null);

    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: source }),
      });
      const raw = await response.text();
      let data: { translationFa?: string; errorFa?: string } | null = null;
      if (raw) {
        try {
          data = JSON.parse(raw) as { translationFa?: string; errorFa?: string };
        } catch {
          data = null;
        }
      }

      if (translationReqIdRef.current !== reqId) return;

      if (!response.ok || !data?.translationFa) {
        setTranslationError(
          data?.errorFa || 'دریافت ترجمه با خطا روبه‌رو شد. لطفاً دوباره امتحان کنید.',
        );
        return;
      }

      translationCacheRef.current.set(source, data.translationFa);
      setTranslationFa(data.translationFa);
    } catch {
      if (translationReqIdRef.current !== reqId) return;
      setTranslationError('ارتباط با سرویس ترجمه برقرار نشد. لطفاً دوباره امتحان کنید.');
    } finally {
      if (translationReqIdRef.current === reqId) {
        setTranslationLoading(false);
      }
    }
  }, []);

  const loadExamples = useCallback(async (source: string) => {
    if (!source) {
      setExamples(CURATED_GERMAN_EXAMPLES);
      setExamplesError(null);
      return;
    }

    const cached = examplesCacheRef.current.get(source);
    if (cached && cached.length > 0) {
      setExamples(cached);
      setExamplesError(null);
      return;
    }

    const reqId = ++examplesReqIdRef.current;
    setExamplesLoading(true);
    setExamplesError(null);

    try {
      const response = await fetch('/api/examples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: source }),
      });
      const raw = await response.text();
      let data: { examples?: GermanExample[]; errorFa?: string } | null = null;
      if (raw) {
        try {
          data = JSON.parse(raw) as {
            examples?: GermanExample[];
            errorFa?: string;
          };
        } catch {
          data = null;
        }
      }

      if (examplesReqIdRef.current !== reqId) return;

      if (!response.ok || !Array.isArray(data?.examples) || data.examples.length === 0) {
        setExamplesError(
          data?.errorFa || 'دریافت مثال‌ها با خطا روبه‌رو شد. لطفاً دوباره امتحان کنید.',
        );
        return;
      }

      examplesCacheRef.current.set(source, data.examples);
      setExamples(data.examples);
    } catch {
      if (examplesReqIdRef.current !== reqId) return;
      setExamplesError('ارتباط با سرویس مثال‌ها برقرار نشد. لطفاً دوباره امتحان کنید.');
    } finally {
      if (examplesReqIdRef.current === reqId) {
        setExamplesLoading(false);
      }
    }
  }, []);

  const handleToggleTranslation = () => {
    if (!hasText || disabled) return;
    const nextOpen = !translationOpen;
    setTranslationOpen(nextOpen);
    if (nextOpen && !translationFa && !translationLoading) {
      void loadTranslation(trimmedText);
    }
  };

  const handleToggleExamples = () => {
    if (disabled) return;
    const nextOpen = !examplesOpen;
    setExamplesOpen(nextOpen);
    if (nextOpen) {
      if (!hasText) {
        setExamples(CURATED_GERMAN_EXAMPLES);
        setExamplesError(null);
      } else if (examples.length === 0 && !examplesLoading) {
        void loadExamples(trimmedText);
      }
    }
  };

  return (
    <section
      aria-label="Translation and practice examples"
      className="mt-4 border-t border-[rgba(26,25,24,0.08)]"
    >
      {/* Accordion 1: Persian Translation */}
      <div className="border-b border-[rgba(26,25,24,0.08)]">
        <button
          type="button"
          onClick={handleToggleTranslation}
          disabled={!hasText || disabled}
          aria-expanded={translationOpen}
          aria-controls="panel-persian-translation"
          dir="rtl"
          lang="fa"
          className="flex min-h-[48px] w-full items-center justify-between gap-4 py-3 text-right font-persian text-[14px] font-medium text-[#736F68] transition-colors duration-150 ease-out hover:text-[#1A1918] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A1918]"
        >
          <span className="whitespace-nowrap">ترجمه فارسی</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-[#736F68] transition-transform duration-200 ease-out ${
              translationOpen ? 'rotate-180' : ''
            }`}
            strokeWidth={1.6}
            aria-hidden="true"
          />
        </button>

        {translationOpen && (
          <div
            id="panel-persian-translation"
            role="region"
            aria-label="Persian translation"
            dir="rtl"
            lang="fa"
            className="pb-5 pt-1"
          >
            {translationLoading ? (
              <p className="font-persian text-[14px] text-[#736F68]">
                در حال ترجمه...
              </p>
            ) : translationError ? (
              <div className="flex items-center justify-between gap-4">
                <p className="font-persian text-[14px] text-[#C24D3A]">
                  {translationError}
                </p>
                <button
                  type="button"
                  onClick={() => void loadTranslation(trimmedText)}
                  className="min-h-[36px] shrink-0 rounded-full px-3 font-persian text-[13px] font-medium text-[#1A1918] transition-colors duration-150 hover:bg-[#F2EFE9] whitespace-nowrap"
                >
                  تلاش مجدد
                </button>
              </div>
            ) : translationFa ? (
              <p className="font-persian text-[16px] leading-[1.85] text-[#1A1918]/90 [text-wrap:pretty]">
                {translationFa}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* Accordion 2: German Examples (Listen + Practice) */}
      <div className="border-b border-[rgba(26,25,24,0.08)]">
        <button
          type="button"
          onClick={handleToggleExamples}
          disabled={disabled}
          aria-expanded={examplesOpen}
          aria-controls="panel-german-examples"
          dir="rtl"
          lang="fa"
          className="flex min-h-[48px] w-full items-center justify-between gap-4 py-3 text-right font-persian text-[14px] font-medium text-[#736F68] transition-colors duration-150 ease-out hover:text-[#1A1918] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A1918]"
        >
          <span className="whitespace-nowrap">مثال‌ها</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-[#736F68] transition-transform duration-200 ease-out ${
              examplesOpen ? 'rotate-180' : ''
            }`}
            strokeWidth={1.6}
            aria-hidden="true"
          />
        </button>

        {examplesOpen && (
          <div
            id="panel-german-examples"
            role="region"
            aria-label="German example sentences"
            className="pb-3 pt-1"
          >
            {examplesLoading ? (
              <p
                dir="rtl"
                lang="fa"
                className="pb-3 font-persian text-[14px] text-[#736F68]"
              >
                در حال آماده‌سازی مثال‌ها...
              </p>
            ) : examplesError ? (
              <div
                dir="rtl"
                lang="fa"
                className="flex items-center justify-between gap-4 pb-3"
              >
                <p className="font-persian text-[14px] text-[#C24D3A]">
                  {examplesError}
                </p>
                <button
                  type="button"
                  onClick={() => void loadExamples(trimmedText)}
                  className="min-h-[36px] shrink-0 rounded-full px-3 font-persian text-[13px] font-medium text-[#1A1918] transition-colors duration-150 hover:bg-[#F2EFE9] whitespace-nowrap"
                >
                  تلاش مجدد
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-[rgba(26,25,24,0.06)]">
                {examples.map((example, idx) => {
                  const key = `example-${idx}-${example.de}`;
                  const isPlaying = activeSpeechKey === key;
                  const isLoading = loadingSpeechKey === key;

                  return (
                    <li key={key} className="py-4 first:pt-2 last:pb-2">
                      <p
                        dir="ltr"
                        lang="de"
                        className="text-[17px] sm:text-[18px] leading-[1.55] tracking-[-0.01em] text-[#1A1918]"
                      >
                        {example.de}
                      </p>

                      <p
                        dir="rtl"
                        lang="fa"
                        className="mt-1 font-persian text-[13px] leading-[1.75] text-[#736F68] [text-wrap:pretty]"
                      >
                        {example.fa}
                      </p>

                      <div className="mt-2 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => onSpeakExample(example.de, key)}
                          aria-label={
                            isPlaying
                              ? `Stop example: ${example.de}`
                              : `Listen to example: ${example.de}`
                          }
                          className="inline-flex min-h-[40px] -ml-2.5 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-[#736F68] transition-colors duration-150 ease-out hover:bg-[#F2EFE9] hover:text-[#1A1918] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A1918]"
                        >
                          {isLoading ? (
                            <Loader2
                              className="h-[14px] w-[14px] animate-spin text-[#736F68]"
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                          ) : isPlaying ? (
                            <Square
                              className="h-[12px] w-[12px] fill-current text-[#1A1918]"
                              aria-hidden="true"
                            />
                          ) : (
                            <Volume2
                              className="h-[15px] w-[15px]"
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                          )}
                          <span dir="rtl" lang="fa" className="font-persian">
                            {isPlaying ? 'توقف' : 'پخش'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setExamplesOpen(false);
                            onPracticeExample(example.de);
                          }}
                          aria-label={`Practice example: ${example.de}`}
                          dir="rtl"
                          lang="fa"
                          className="inline-flex min-h-[40px] -mr-2.5 items-center rounded-full px-3 font-persian text-[13px] font-medium text-[#1A1918] transition-colors duration-150 ease-out hover:bg-[#F2EFE9] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A1918]"
                        >
                          تمرین
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
