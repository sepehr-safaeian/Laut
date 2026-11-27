import { useCallback, useEffect, useRef, useState } from 'react';
import { isRecordingUsable } from '../utils/pronunciation';

const BAR_COUNT = 16;
const INITIAL_LEVELS = Array.from({ length: BAR_COUNT }, () => 0.12);

export interface RecordedAudioResult {
  audioBase64: string;
  mimeType: string;
  durationMs: number;
}

export type RecordingFailure =
  | { reason: 'permission_denied' }
  | { reason: 'unsupported' }
  | { reason: 'too_short' }
  | { reason: 'silent' }
  | { reason: 'empty' };

function selectRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to encode audio blob'));
    reader.readAsDataURL(blob);
  });
}

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(INITIAL_LEVELS);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const timerIdRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const peakRmsRef = useRef<number>(0);
  const stopResolverRef = useRef<
    ((result: RecordedAudioResult | RecordingFailure) => void) | null
  >(null);

  const cleanupMediaResources = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (timerIdRef.current !== null) {
      window.clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setLevels(INITIAL_LEVELS);
  }, []);

  useEffect(() => {
    return () => {
      cleanupMediaResources();
    };
  }, [cleanupMediaResources]);

  const startRecording = useCallback(async (): Promise<
    { ok: true } | { ok: false; failure: RecordingFailure }
  > => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      return { ok: false, failure: { reason: 'unsupported' } };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const mimeType = selectRecorderMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 })
          : new MediaRecorder(stream, { audioBitsPerSecond: 32000 });
      } catch {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      }

      chunksRef.current = [];
      peakRmsRef.current = 0;
      startTimeRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const durationMs = Date.now() - startTimeRef.current;
        const resolvedMime = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: resolvedMime });
        const peakRms = peakRmsRef.current;
        const resolver = stopResolverRef.current;
        stopResolverRef.current = null;

        cleanupMediaResources();

        if (!resolver) return;

        const usability = isRecordingUsable({
          durationMs,
          peakRms,
          byteSize: blob.size,
        });

        if (!usability.ok) {
          resolver({ reason: usability.reason });
          return;
        }

        try {
          const audioBase64 = await blobToBase64(blob);
          resolver({
            audioBase64,
            mimeType: resolvedMime,
            durationMs,
          });
        } catch {
          resolver({ reason: 'empty' });
        }
      };

      // Set up Web Audio API AnalyserNode for smooth real-time acoustic level visualization
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.78;
        source.connect(analyser);

        audioContextRef.current = audioCtx;
        analyserRef.current = analyser;

        const timeData = new Uint8Array(analyser.fftSize);
        const freqData = new Uint8Array(analyser.frequencyBinCount);

        const sampleFrame = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteTimeDomainData(timeData);

          let sumSquares = 0;
          for (let i = 0; i < timeData.length; i++) {
            const normalized = (timeData[i] - 128) / 128;
            sumSquares += normalized * normalized;
          }
          const rms = Math.sqrt(sumSquares / timeData.length);
          if (rms > peakRmsRef.current) {
            peakRmsRef.current = rms;
          }

          analyserRef.current.getByteFrequencyData(freqData);
          const half = BAR_COUNT / 2;
          const usableBins = Math.max(half, Math.floor(freqData.length * 0.45));
          const step = Math.max(1, Math.floor(usableBins / half));
          const bandValues: number[] = [];
          for (let b = 0; b < half; b++) {
            let acc = 0;
            for (let j = 0; j < step; j++) {
              acc += freqData[b * step + j] ?? 0;
            }
            const avg = acc / (step * 255);
            const energy = Math.max(avg, rms * 1.45);
            // Gentle taper toward outer edges for a calm symmetrical Swiss meter
            const envelope = 1 - (b / half) * 0.42;
            const shaped = Math.min(
              1,
              Math.max(0.14, Math.pow(energy, 0.72) * 1.15 * envelope),
            );
            bandValues.push(shaped);
          }
          // Mirror around center: outer-left -> center -> outer-right
          const nextLevels = [...bandValues.slice().reverse(), ...bandValues];
          setLevels(nextLevels);
          rafIdRef.current = requestAnimationFrame(sampleFrame);
        };

        rafIdRef.current = requestAnimationFrame(sampleFrame);
      }

      mediaRecorderRef.current = recorder;
      recorder.start(120);
      setIsRecording(true);
      setElapsedSeconds(0);

      timerIdRef.current = window.setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 250);

      return { ok: true };
    } catch {
      cleanupMediaResources();
      return { ok: false, failure: { reason: 'permission_denied' } };
    }
  }, [cleanupMediaResources]);

  const stopRecording = useCallback((): Promise<RecordedAudioResult | RecordingFailure> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        cleanupMediaResources();
        resolve({ reason: 'empty' });
        return;
      }
      stopResolverRef.current = resolve;
      recorder.stop();
    });
  }, [cleanupMediaResources]);

  const cancelRecording = useCallback(() => {
    stopResolverRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    cleanupMediaResources();
  }, [cleanupMediaResources]);

  return {
    isRecording,
    elapsedSeconds,
    levels,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
