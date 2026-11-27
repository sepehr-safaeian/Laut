import type {
  IssueSeverity,
  PronunciationAnalysis,
  WordStatus,
} from '../types/pronunciation';
import {
  getErrorTagFa,
  getWordStatusLabelFa,
  highlightProblemSubstring,
  isPerfectPronunciation,
  stripWordPunctuation,
} from '../utils/pronunciation';

interface DiagnosticViewProps {
  analysis: PronunciationAnalysis;
  activeWordKey: string | null;
  loadingWordKey: string | null;
  onSpeakWord: (word: string, key: string) => void;
}

function getScoreBarColor(score: number): string {
  if (score >= 85) return 'bg-[#2E6F56]';
  if (score >= 65) return 'bg-[#B4732A]';
  return 'bg-[#C24D3A]';
}

function getWordButtonClasses(status: WordStatus, isActive: boolean): string {
  const base =
    'inline-flex items-baseline rounded-[5px] px-1 py-0.5 text-[21px] sm:text-[23px] leading-[1.6] tracking-[-0.012em] transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A1918] cursor-pointer';

  const activeRing = isActive ? 'bg-[#F2EFE9]' : '';

  switch (status) {
    case 'accurate':
      return `${base} text-[#1A1918] underline decoration-[#2E6F56]/45 decoration-[1.5px] underline-offset-[6px] hover:bg-[#F2EFE9] ${activeRing}`;
    case 'imprecise':
      return `${base} text-[#1A1918] bg-[#B4732A]/[0.08] underline decoration-[#B4732A] decoration-[2px] underline-offset-[6px] hover:bg-[#B4732A]/[0.15] ${activeRing}`;
    case 'mispronounced':
      return `${base} text-[#1A1918] bg-[#C24D3A]/[0.08] underline decoration-[#C24D3A] decoration-[2px] underline-offset-[6px] hover:bg-[#C24D3A]/[0.15] ${activeRing}`;
    case 'omitted':
      return `${base} text-[#736F68] bg-[#C24D3A]/[0.05] underline decoration-[#C24D3A]/85 decoration-dashed decoration-[1.5px] underline-offset-[6px] hover:bg-[#C24D3A]/[0.12] ${activeRing}`;
  }
}

function getSeverityTextColor(severity: IssueSeverity): string {
  return severity === 'imprecise' ? 'text-[#9A5F1F]' : 'text-[#C24D3A]';
}

function getHighlightColor(severity: IssueSeverity): string {
  return severity === 'imprecise'
    ? 'text-[#9A5F1F] decoration-[#B4732A]'
    : 'text-[#C24D3A] decoration-[#C24D3A]';
}

export function DiagnosticView({
  analysis,
  activeWordKey,
  loadingWordKey,
  onSpeakWord,
}: DiagnosticViewProps) {
  const isPerfect = isPerfectPronunciation(analysis);

  return (
    <section
      aria-label="Pronunciation diagnostic feedback"
      className="border-t border-[rgba(26,25,24,0.08)] pt-8 pb-6"
    >
      {/* Understated Accuracy Readout & Hairline Progress Indicator */}
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-[28px] sm:text-[32px] font-medium tabular-nums tracking-[-0.02em] text-[#1A1918]">
            {analysis.overallScore}%
          </span>
          <span
            dir="rtl"
            lang="fa"
            className="font-persian text-[13px] text-[#736F68]"
          >
            دقت تلفظ
          </span>
        </div>

        <div
          role="progressbar"
          aria-valuenow={analysis.overallScore}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Pronunciation accuracy score"
          className="mt-3 h-[2px] w-full overflow-hidden bg-[rgba(26,25,24,0.08)]"
        >
          <div
            className={`h-full origin-left transition-transform duration-300 ease-out ${getScoreBarColor(
              analysis.overallScore,
            )}`}
            style={{
              transform: `scaleX(${Math.max(0, Math.min(1, analysis.overallScore / 100))})`,
            }}
          />
        </div>
      </div>

      {/* Interactive Analyzed German Sentence (Tap-to-Hear Any Word) */}
      <div className="mt-8">
        <div
          dir="ltr"
          lang="de"
          className="-ml-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-2"
        >
          {analysis.words.map((item, idx) => {
            const cleanWord = stripWordPunctuation(item.word) || item.word;
            const key = `word-${idx}-${cleanWord}`;
            const statusLabelFa = getWordStatusLabelFa(item.status);
            const isActive = activeWordKey === key || loadingWordKey === key;

            return (
              <button
                key={key}
                type="button"
                onClick={() => onSpeakWord(cleanWord, key)}
                title={`${cleanWord} — ${statusLabelFa}`}
                aria-label={`Listen to ${cleanWord}, status: ${item.status}`}
                className={getWordButtonClasses(item.status, isActive)}
              >
                {item.word}
              </button>
            );
          })}
        </div>

        <p
          dir="rtl"
          lang="fa"
          className="mt-3 font-persian text-[12px] text-[#736F68]"
        >
          برای شنیدن تلفظ صحیح هر واژه، روی آن کلیک کنید.
        </p>
      </div>

      {/* Calm Confirmation OR Focused Error Diagnostics */}
      {isPerfect ? (
        <p
          dir="rtl"
          lang="fa"
          className="mt-8 border-t border-[rgba(26,25,24,0.08)] pt-6 font-persian text-[15px] font-medium text-[#2E6F56]"
        >
          تلفظ دقیق و طبیعی بود.
        </p>
      ) : analysis.issues.length > 0 ? (
        <ul
          aria-label="Specific pronunciation diagnostics"
          className="mt-8 divide-y divide-[rgba(26,25,24,0.08)] border-t border-[rgba(26,25,24,0.08)]"
        >
          {analysis.issues.map((issue, idx) => {
            const parts = highlightProblemSubstring(
              issue.word,
              issue.problemSubstring,
            );
            const wordKey = `issue-${idx}-${issue.word}`;
            const isActive = activeWordKey === wordKey || loadingWordKey === wordKey;

            return (
              <li key={wordKey} className="py-5 first:pt-6 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div dir="ltr" className="flex flex-wrap items-baseline gap-2.5">
                    <button
                      type="button"
                      lang="de"
                      onClick={() => onSpeakWord(issue.word, wordKey)}
                      aria-label={`Listen to ${issue.word}`}
                      className={`-ml-1.5 rounded-[5px] px-1.5 py-0.5 text-[18px] font-medium tracking-[-0.01em] text-[#1A1918] transition-colors duration-150 ease-out hover:bg-[#F2EFE9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A1918] cursor-pointer ${
                        isActive ? 'bg-[#F2EFE9]' : ''
                      }`}
                    >
                      {parts.match ? (
                        <>
                          <span>{parts.before}</span>
                          <mark
                            className={`bg-transparent font-semibold underline decoration-[1.5px] underline-offset-[4px] ${getHighlightColor(
                              issue.severity,
                            )}`}
                          >
                            {parts.match}
                          </mark>
                          <span>{parts.after}</span>
                        </>
                      ) : (
                        <span>{issue.word}</span>
                      )}
                    </button>

                    {issue.ipaTarget && (
                      <span className="font-mono text-[12px] text-[#736F68]">
                        {issue.ipaTarget}
                      </span>
                    )}
                  </div>

                  <span
                    dir="rtl"
                    lang="fa"
                    className={`font-persian text-[12px] font-medium whitespace-nowrap ${getSeverityTextColor(
                      issue.severity,
                    )}`}
                  >
                    {getErrorTagFa(issue.severity)}
                  </span>
                </div>

                <p
                  dir="rtl"
                  lang="fa"
                  className="mt-2 font-persian text-[15px] leading-[1.85] text-[#1A1918]/85 [text-wrap:pretty]"
                >
                  {issue.explanationFa}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p
          dir="rtl"
          lang="fa"
          className="mt-8 border-t border-[rgba(26,25,24,0.08)] pt-6 font-persian text-[14px] text-[#736F68]"
        >
          نکته خطای خاصی ثبت نشد؛ برای دقت بیشتر می‌توانید یک بار دیگر امتحان کنید.
        </p>
      )}
    </section>
  );
}
