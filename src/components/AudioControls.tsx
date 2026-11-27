import { Loader2, Mic, Square, Volume2 } from 'lucide-react';
import type { PlaybackSpeed, RecorderState } from '../types/pronunciation';
import { formatElapsedSeconds } from '../utils/pronunciation';

interface AudioControlsProps {
  hasText: boolean;
  speed: PlaybackSpeed;
  onToggleSpeed: () => void;
  isListening: boolean;
  isListenLoading: boolean;
  onListen: () => void;
  recorderState: RecorderState;
  elapsedSeconds: number;
  levels: number[];
  onToggleRecord: () => void;
}

export function AudioControls({
  hasText,
  speed,
  onToggleSpeed,
  isListening,
  isListenLoading,
  onListen,
  recorderState,
  elapsedSeconds,
  levels,
  onToggleRecord,
}: AudioControlsProps) {
  const isRecording = recorderState === 'recording';
  const isAnalyzing = recorderState === 'analyzing';

  return (
    <section
      aria-label="Audio playback and recording controls"
      className="mt-7 border-t border-[rgba(26,25,24,0.08)] pt-5"
    >
      {/* Minimal Listen & Speed Bar */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onListen}
          disabled={!hasText || isRecording || isAnalyzing}
          aria-label={isListening ? 'Stop listening' : 'Listen to native German pronunciation'}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-3.5 -ml-3.5 text-[14px] font-medium text-[#1A1918] transition-colors duration-150 ease-out hover:bg-[#F2EFE9] disabled:cursor-not-allowed disabled:opacity-35 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A1918]"
        >
          {isListenLoading ? (
            <Loader2 className="h-[16px] w-[16px] animate-spin text-[#736F68]" strokeWidth={1.75} aria-hidden="true" />
          ) : isListening ? (
            <Square className="h-[13px] w-[13px] fill-current text-[#1A1918]" aria-hidden="true" />
          ) : (
            <Volume2 className="h-[17px] w-[17px] text-[#1A1918]" strokeWidth={1.75} aria-hidden="true" />
          )}
          <span>{isListening ? 'Stop' : 'Listen'}</span>
        </button>

        <span className="text-[#736F68]/40 select-none" aria-hidden="true">
          ·
        </span>

        <button
          type="button"
          onClick={onToggleSpeed}
          disabled={isRecording || isAnalyzing}
          aria-label={`Playback speed ${speed === 1 ? '1.0x' : '0.75x'}, click to switch`}
          className="inline-flex min-h-[44px] min-w-[48px] items-center justify-center rounded-full px-2.5 text-[13px] font-medium tabular-nums text-[#736F68] transition-colors duration-150 ease-out hover:bg-[#F2EFE9] hover:text-[#1A1918] disabled:cursor-not-allowed disabled:opacity-35 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A1918]"
        >
          {speed === 1 ? '1.0×' : '0.75×'}
        </button>
      </div>

      {/* Tactile Centered Microphone Focal Anchor */}
      <div className="flex flex-col items-center pt-8 pb-6 sm:pt-10 sm:pb-8">
        <button
          type="button"
          onClick={onToggleRecord}
          disabled={isAnalyzing}
          aria-pressed={isRecording}
          aria-label={
            isAnalyzing
              ? 'Analyzing pronunciation'
              : isRecording
                ? 'Stop recording and analyze'
                : 'Start recording your pronunciation'
          }
          className={`group relative flex h-16 w-16 sm:h-[68px] sm:w-[68px] items-center justify-center rounded-full transition-all duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1A1918] active:scale-[0.96] disabled:cursor-wait ${
            isRecording
              ? 'bg-[#C24D3A] text-[#FAF9F6]'
              : isAnalyzing
                ? 'bg-[#F2EFE9] text-[#736F68]'
                : 'bg-[#1A1918] text-[#FAF9F6] hover:bg-[#2B2927]'
          }`}
        >
          {isAnalyzing ? (
            <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          ) : isRecording ? (
            <Square className="h-5 w-5 fill-current" aria-hidden="true" />
          ) : (
            <Mic className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>

        {/* Live Acoustic Waveform & Timer or Calm Status Line */}
        <div className="mt-5 flex h-7 items-center justify-center">
          {isRecording ? (
            <div
              role="status"
              aria-label="Recording audio"
              className="flex items-center gap-3.5"
            >
              <div className="flex h-6 items-center gap-[3.5px]">
                {levels.map((level, idx) => (
                  <span
                    key={idx}
                    aria-hidden="true"
                    className="block w-[2px] rounded-full bg-[#C24D3A]/85 transition-transform duration-75 ease-out will-change-transform"
                    style={{
                      height: '20px',
                      transform: `scaleY(${level.toFixed(3)})`,
                    }}
                  />
                ))}
              </div>
              <span
                aria-live="off"
                className="font-mono text-[12px] tabular-nums tracking-tight text-[#C24D3A]"
              >
                {formatElapsedSeconds(elapsedSeconds)}
              </span>
            </div>
          ) : isAnalyzing ? (
            <p
              role="status"
              dir="rtl"
              lang="fa"
              className="font-persian text-[13px] text-[#736F68]"
            >
              در حال تحلیل تلفظ...
            </p>
          ) : (
            <p
              dir="rtl"
              lang="fa"
              className="font-persian text-[13px] text-[#736F68]/80"
            >
              {hasText ? 'برای ضبط صدا ضربه بزنید' : 'جمله‌ای بنویسید و تلفظ کنید'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
