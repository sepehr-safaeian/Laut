import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackSpeed } from '../types/pronunciation';

interface SpeakOptions {
  rate?: PlaybackSpeed;
  activeKey?: string;
}

function base64ToWavUrl(base64: string, mimeType = 'audio/wav'): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

function pickGermanVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const exactDe = voices.filter((v) =>
    v.lang.toLowerCase().replace('_', '-').startsWith('de-de'),
  );
  if (exactDe.length > 0) {
    return (
      exactDe.find((v) => /google|anna|helena|markus|petra|natural|neural/i.test(v.name)) ??
      exactDe[0]
    );
  }

  return (
    voices.find((v) => v.lang.toLowerCase().startsWith('de')) ?? null
  );
}

export function useGermanSpeech() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Map<string, string>>(new Map());
  const requestIdRef = useRef(0);

  const stop = useCallback(() => {
    requestIdRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setActiveKey(null);
    setLoadingKey(null);
  }, []);

  useEffect(() => {
    // Prime browser voice list early if speechSynthesis fallback is ever needed
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
    const cache = cacheRef.current;
    return () => {
      stop();
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, [stop]);

  const speakWithBrowserFallback = useCallback(
    (text: string, rate: PlaybackSpeed, key: string, reqId: number) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        if (requestIdRef.current === reqId) {
          setActiveKey(null);
          setLoadingKey(null);
        }
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'de-DE';
      utterance.rate = rate;
      const voice = pickGermanVoice();
      if (voice) {
        utterance.voice = voice;
      }

      utterance.onstart = () => {
        if (requestIdRef.current === reqId) {
          setLoadingKey(null);
          setActiveKey(key);
        }
      };
      utterance.onend = () => {
        if (requestIdRef.current === reqId) {
          setActiveKey(null);
          setLoadingKey(null);
        }
      };
      utterance.onerror = () => {
        if (requestIdRef.current === reqId) {
          setActiveKey(null);
          setLoadingKey(null);
        }
      };

      setLoadingKey(null);
      setActiveKey(key);
      window.speechSynthesis.speak(utterance);
    },
    [],
  );

  const playCachedAudioUrl = useCallback(
    (url: string, rate: PlaybackSpeed, key: string, reqId: number): Promise<boolean> => {
      return new Promise((resolve) => {
        if (requestIdRef.current !== reqId) {
          resolve(false);
          return;
        }
        const audio = new Audio(url);
        audio.playbackRate = rate;
        if ('preservesPitch' in audio) {
          audio.preservesPitch = true;
        }
        audioRef.current = audio;

        audio.onended = () => {
          if (requestIdRef.current === reqId) {
            setActiveKey(null);
            setLoadingKey(null);
            audioRef.current = null;
          }
        };
        audio.onerror = () => {
          if (requestIdRef.current === reqId) {
            audioRef.current = null;
          }
          resolve(false);
        };

        audio
          .play()
          .then(() => {
            if (requestIdRef.current === reqId) {
              setLoadingKey(null);
              setActiveKey(key);
            }
            resolve(true);
          })
          .catch(() => {
            if (requestIdRef.current === reqId) {
              audioRef.current = null;
            }
            resolve(false);
          });
      });
    },
    [],
  );

  const speak = useCallback(
    async (rawText: string, options: SpeakOptions = {}) => {
      const cleanText = rawText.trim();
      if (!cleanText) return;

      const rate: PlaybackSpeed = options.rate ?? 1;
      const key = options.activeKey ?? `text:${cleanText}`;

      // Toggle off if clicking the exact same active control
      if (activeKey === key || loadingKey === key) {
        stop();
        return;
      }

      stop();
      const reqId = requestIdRef.current;

      // Instant playback if audio is already cached
      const cachedUrl = cacheRef.current.get(cleanText);
      if (cachedUrl) {
        const played = await playCachedAudioUrl(cachedUrl, rate, key, reqId);
        if (!played && requestIdRef.current === reqId) {
          speakWithBrowserFallback(cleanText, rate, key, reqId);
        }
        return;
      }

      setLoadingKey(key);
      try {
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: cleanText }),
        });

        if (requestIdRef.current !== reqId) return;

        if (!response.ok) {
          speakWithBrowserFallback(cleanText, rate, key, reqId);
          return;
        }

        const data = (await response.json()) as {
          audioBase64?: string;
          mimeType?: string;
        };

        if (requestIdRef.current !== reqId) return;

        if (!data.audioBase64) {
          speakWithBrowserFallback(cleanText, rate, key, reqId);
          return;
        }

        const url = base64ToWavUrl(data.audioBase64, data.mimeType || 'audio/wav');
        // Keep cache bounded
        if (cacheRef.current.size >= 40) {
          const oldestKey = cacheRef.current.keys().next().value;
          if (oldestKey) {
            const oldestUrl = cacheRef.current.get(oldestKey);
            if (oldestUrl) URL.revokeObjectURL(oldestUrl);
            cacheRef.current.delete(oldestKey);
          }
        }
        cacheRef.current.set(cleanText, url);

        const played = await playCachedAudioUrl(url, rate, key, reqId);
        if (!played && requestIdRef.current === reqId) {
          speakWithBrowserFallback(cleanText, rate, key, reqId);
        }
      } catch {
        if (requestIdRef.current === reqId) {
          speakWithBrowserFallback(cleanText, rate, key, reqId);
        }
      }
    },
    [activeKey, loadingKey, playCachedAudioUrl, speakWithBrowserFallback, stop],
  );

  return {
    activeKey,
    loadingKey,
    speak,
    stop,
  };
}
