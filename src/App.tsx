import { useCallback, useState } from 'react';
import { AudioControls } from './components/AudioControls';
import { DiagnosticView } from './components/DiagnosticView';
import { EditorialInput } from './components/EditorialInput';
import { StudyAccordions } from './components/StudyAccordions';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useGermanSpeech } from './hooks/useGermanSpeech';
import type {
  NoticeMessage,
  PlaybackSpeed,
  PronunciationAnalysis,
  RecorderState,
} from './types/pronunciation';

const SENTENCE_SPEECH_KEY = 'sentence-playback';

export default function App() {
  const [text, setText] = useState('');
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<PronunciationAnalysis | null>(null);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);

  const { activeKey, loadingKey, speak, stop: stopSpeech } = useGermanSpeech();
  const {
    isRecording,
    elapsedSeconds,
    levels,
    startRecording,
    stopRecording,
  } = useAudioRecorder();

  const trimmedText = text.trim();
  const hasText = trimmedText.length > 0;
  const recorderState: RecorderState = isAnalyzing
    ? 'analyzing'
    : isRecording
      ? 'recording'
      : 'idle';

  const handleTextChange = useCallback(
    (nextValue: string) => {
      setText(nextValue);
      setNotice(null);
      if (analysis) {
        setAnalysis(null);
      }
      if (activeKey || loadingKey) {
        stopSpeech();
      }
    },
    [activeKey, analysis, loadingKey, stopSpeech],
  );

  const handleClear = useCallback(() => {
    setText('');
    setAnalysis(null);
    setNotice(null);
    stopSpeech();
  }, [stopSpeech]);

  const handleToggleSpeed = useCallback(() => {
    setSpeed((prev) => (prev === 1 ? 0.75 : 1));
  }, []);

  const handleListenSentence = useCallback(() => {
    if (!trimmedText) return;
    setNotice(null);
    void speak(trimmedText, { rate: speed, activeKey: SENTENCE_SPEECH_KEY });
  }, [speak, speed, trimmedText]);

  const handleSpeakWord = useCallback(
    (word: string, key: string) => {
      if (!word.trim()) return;
      void speak(word, { rate: speed, activeKey: key });
    },
    [speak, speed],
  );

  const handlePracticeExample = useCallback(
    (sentence: string) => {
      stopSpeech();
      setText(sentence);
      setAnalysis(null);
      setNotice(null);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [stopSpeech],
  );

  const handleToggleRecord = useCallback(async () => {
    if (isAnalyzing) return;

    if (!isRecording) {
      if (!trimmedText) {
        setNotice({
          kind: 'info',
          textFa: 'ابتدا یک جمله یا عبارت آلمانی در بالا بنویسید.',
        });
        return;
      }

      stopSpeech();
      setNotice(null);

      const started = await startRecording();
      if (!started.ok) {
        if (started.failure.reason === 'unsupported') {
          setNotice({
            kind: 'error',
            textFa: 'مرورگر شما از ضبط صدا پشتیبانی نمی‌کند.',
          });
        } else {
          setNotice({
            kind: 'error',
            textFa: 'دسترسی به میکروفون رد شد. لطفاً اجازه میکروفون را در مرورگر فعال کنید.',
          });
        }
      }
      return;
    }

    const result = await stopRecording();
    if ('reason' in result) {
      if (result.reason === 'too_short') {
        setNotice({
          kind: 'info',
          textFa: 'ضبط صدا خیلی کوتاه بود. جمله را کامل بخوانید و دوباره تلاش کنید.',
        });
      } else if (result.reason === 'silent') {
        setNotice({
          kind: 'info',
          textFa: 'صدایی شنیده نشد. میکروفون را بررسی کنید و کمی واضح‌تر صحبت کنید.',
        });
      } else {
        setNotice({
          kind: 'error',
          textFa: 'ضبط صدا انجام نشد. لطفاً دوباره امتحان کنید.',
        });
      }
      return;
    }

    setIsAnalyzing(true);
    setNotice(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetText: trimmedText,
          audioBase64: result.audioBase64,
          mimeType: result.mimeType,
        }),
      });

      const rawBody = await response.text();
      let payload: PronunciationAnalysis | { errorFa?: string } | null = null;
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody) as PronunciationAnalysis | { errorFa?: string };
        } catch {
          payload = null;
        }
      }

      if (!response.ok || !payload || !('overallScore' in payload)) {
        setNotice({
          kind: 'error',
          textFa:
            (payload && 'errorFa' in payload && payload.errorFa) ||
            'تحلیل تلفظ با خطا روبه‌رو شد. لطفاً دوباره تلاش کنید.',
        });
        return;
      }

      const analyzed = payload;
      if (!analyzed.speechDetected) {
        setAnalysis(null);
        setNotice({
          kind: 'info',
          textFa: 'گفتار واضحی در فایل صوتی تشخیص داده نشد. لطفاً دوباره ضبط کنید.',
        });
        return;
      }

      setAnalysis(analyzed);
    } catch {
      setNotice({
        kind: 'error',
        textFa: 'ارتباط با سرویس تحلیل برقرار نشد. لطفاً دوباره امتحان کنید.',
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [isAnalyzing, isRecording, startRecording, stopRecording, stopSpeech, trimmedText]);

  return (
    <div className="min-h-dvh bg-[#FAF9F6] text-[#1A1918]">
      <main className="mx-auto max-w-2xl px-6 py-14 sm:px-8 sm:py-24">
        <EditorialInput
          value={text}
          onChange={handleTextChange}
          onClear={handleClear}
          disabled={isRecording || isAnalyzing}
        />

        <AudioControls
          hasText={hasText}
          speed={speed}
          onToggleSpeed={handleToggleSpeed}
          isListening={activeKey === SENTENCE_SPEECH_KEY}
          isListenLoading={loadingKey === SENTENCE_SPEECH_KEY}
          onListen={handleListenSentence}
          recorderState={recorderState}
          elapsedSeconds={elapsedSeconds}
          levels={levels}
          onToggleRecord={handleToggleRecord}
        />

        {notice && (
          <div
            role={notice.kind === 'error' ? 'alert' : 'status'}
            dir="rtl"
            lang="fa"
            className={`mt-2 border-t border-[rgba(26,25,24,0.08)] pt-5 font-persian text-[14px] leading-[1.75] ${
              notice.kind === 'error' ? 'text-[#C24D3A]' : 'text-[#736F68]'
            }`}
          >
            {notice.textFa}
          </div>
        )}

        {analysis && (
          <DiagnosticView
            analysis={analysis}
            activeWordKey={activeKey}
            loadingWordKey={loadingKey}
            onSpeakWord={handleSpeakWord}
          />
        )}

        <StudyAccordions
          targetText={text}
          disabled={isRecording || isAnalyzing}
          activeSpeechKey={activeKey}
          loadingSpeechKey={loadingKey}
          onSpeakExample={handleSpeakWord}
          onPracticeExample={handlePracticeExample}
        />
      </main>
    </div>
  );
}
