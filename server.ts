import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import { ensureWavBytes } from './src/utils/audioWav.ts';
import { normalizeAnalysisResult } from './src/utils/pronunciation.ts';
import {
  normalizeExamplesResult,
  normalizeTranslationResult,
} from './src/utils/studyHelpers.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getStatusCodeFromError(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const record = err as Record<string, unknown>;
  if (typeof record.status === 'number') return record.status;
  if (typeof record.code === 'number') return record.code;
  const msg = typeof record.message === 'string' ? record.message : '';
  if (msg.includes('503') || msg.includes('UNAVAILABLE')) return 503;
  if (msg.includes('500') || msg.includes('INTERNAL')) return 500;
  if (msg.includes('404') || msg.includes('NOT_FOUND')) return 404;
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) return 429;
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED')) return 403;
  if (msg.includes('400') || msg.includes('API_KEY_INVALID')) return 400;
  return undefined;
}

function isDailyQuotaExhausted(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.includes('GenerateRequestsPerDay') ||
    msg.includes('free_tier_requests') ||
    msg.includes('per day limit')
  );
}

const modelCooldownUntil = new Map<string, number>();
const DAILY_QUOTA_COOLDOWN_MS = 10 * 60 * 1000;

function orderModelsByAvailability(models: readonly string[]): string[] {
  const now = Date.now();
  const ready = models.filter((m) => (modelCooldownUntil.get(m) ?? 0) <= now);
  const cooling = models.filter((m) => (modelCooldownUntil.get(m) ?? 0) > now);
  return [...ready, ...cooling];
}

function recordModelCooldownIfNeeded(model: string, err: unknown): void {
  if (getStatusCodeFromError(err) === 429 && isDailyQuotaExhausted(err)) {
    modelCooldownUntil.set(model, Date.now() + DAILY_QUOTA_COOLDOWN_MS);
  }
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const status = getStatusCodeFromError(err);
      if (status === 429 && isDailyQuotaExhausted(err)) {
        throw err;
      }
      const isRetryable = status === 429 || status === 503 || status === 500;
      if (!isRetryable || attempt >= maxRetries) {
        throw err;
      }
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

const PHONETICS_SYSTEM_INSTRUCTION = `You are a strict, sharp native German (Hochdeutsch / Standard German) phonetics coach evaluating a Persian-speaking learner's actual audio recording.

CRITICAL EVALUATION RULES:
1. Listen strictly to the ACTUAL acoustic phonemes produced in the audio. NEVER assume the speaker pronounced a word accurately just because you were given the target text.
2. If the audio is silent, contains only background noise, or has no recognizable speech, set speechDetected to false and overallScore to 0.
3. Evaluate every single word in the target German sentence in order:
   - "accurate": native-like or clearly accurate standard German pronunciation.
   - "imprecise": intelligible, minor accent or slight vowel length/tenseness/stress drift.
   - "mispronounced": clear phonetic error (e.g., wrong umlaut ä/ö/ü pronounced as a/o/u, ich-Laut [ç] vs ach-Laut [x] vs sch [ʃ] confusion, rolled/English r instead of German uvular/vocalized r, sp/st without [ʃ], z pronounced as [z] instead of [ts], v/w confusion, wrong ie [iː] vs ei [aɪ̯], missing final devoicing Auslautverhärtung, wrong word stress).
   - "omitted": the word (or its essential syllable) was skipped or dropped entirely.
4. For "issues": include entries ONLY for words with real errors (status is "mispronounced", "omitted", or "imprecise"). If overallScore >= 95 and there are no notable mistakes, return an empty issues array.
5. For each issue:
   - "word": the clean German word without punctuation.
   - "problemSubstring": the exact contiguous letters inside that German word where the error occurred (e.g., "ö" in "Brötchen", "ch" in "ich", "st" in "Straße", "en" in "kaufen").
   - "ipaTarget": brief standard German IPA transcription for the target word (e.g., "/ˈbʁøːtçən/").
   - "explanationFa": write 1 to 2 concise, natural Persian sentences explaining (a) what was heard in the recording and (b) the exact practical mouth, lip, or tongue articulation tip to pronounce it correctly. Keep German words, letters, and IPA cues in Latin script. Avoid fluff, praise, or filler.`;

const ANALYSIS_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    overallScore: {
      type: Type.INTEGER,
      description: 'Overall German pronunciation accuracy from 0 to 100.',
    },
    speechDetected: {
      type: Type.BOOLEAN,
      description: 'False if the audio is silent, noise-only, or contains no speech.',
    },
    words: {
      type: Type.ARRAY,
      description: 'Word-by-word status for every word in the target text.',
      items: {
        type: Type.OBJECT,
        properties: {
          word: {
            type: Type.STRING,
            description: 'Exact word from the target German sentence.',
          },
          status: {
            type: Type.STRING,
            enum: ['accurate', 'imprecise', 'mispronounced', 'omitted'],
          },
        },
        required: ['word', 'status'],
      },
    },
    issues: {
      type: Type.ARRAY,
      description: 'Detailed phonetic diagnostics ONLY for words with real errors.',
      items: {
        type: Type.OBJECT,
        properties: {
          word: {
            type: Type.STRING,
            description: 'Clean target German word without trailing punctuation.',
          },
          problemSubstring: {
            type: Type.STRING,
            description: 'Exact contiguous substring of problem letters in the word.',
          },
          severity: {
            type: Type.STRING,
            enum: ['mispronounced', 'omitted', 'imprecise'],
          },
          ipaTarget: {
            type: Type.STRING,
            description: 'Standard German IPA for the target word.',
          },
          explanationFa: {
            type: Type.STRING,
            description: 'Concise 1-2 sentence Persian coaching tip with mouth/tongue guidance.',
          },
        },
        required: ['word', 'problemSubstring', 'severity', 'ipaTarget', 'explanationFa'],
      },
    },
  },
  required: ['overallScore', 'speechDetected', 'words', 'issues'],
};

const TRANSLATION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    translationFa: {
      type: Type.STRING,
      description: 'Natural, accurate, idiomatic Persian translation of the German text.',
    },
  },
  required: ['translationFa'],
};

const EXAMPLES_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    examples: {
      type: Type.ARRAY,
      description: '3 to 4 short, natural everyday German example sentences with Persian translations.',
      items: {
        type: Type.OBJECT,
        properties: {
          de: {
            type: Type.STRING,
            description: 'Natural Standard German sentence (5 to 11 words).',
          },
          fa: {
            type: Type.STRING,
            description: 'Concise, natural Persian translation of the German sentence.',
          },
        },
        required: ['de', 'fa'],
      },
    },
  },
  required: ['examples'],
};

function sanitizeAudioMimeType(rawMime: string): string {
  const base = rawMime.split(';')[0].trim().toLowerCase();
  const allowed = new Set([
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/aac',
    'audio/flac',
  ]);
  return allowed.has(base) ? base : 'audio/webm';
}

async function generateGermanTts(
  ai: GoogleGenAI,
  text: string,
): Promise<{ audioBase64: string; mimeType: string }> {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Sprich auf Hochdeutsch: ${text}`,
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const inlineData =
    response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inlineData?.data) {
    throw new Error('Empty audio payload from Gemini TTS');
  }

  const rawBytes = Buffer.from(inlineData.data, 'base64');
  const wavBytes = ensureWavBytes(rawBytes, inlineData.mimeType);
  return {
    audioBase64: Buffer.from(wavBytes).toString('base64'),
    mimeType: 'audio/wav',
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/tts', async (req, res) => {
    const rawText = req.body?.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      res.status(400).json({ error: 'Text is required for speech synthesis.' });
      return;
    }

    const cleanText = rawText.trim().slice(0, 800);

    try {
      const ai = createGeminiClient();
      const audio = await withRetry(() => generateGermanTts(ai, cleanText), 1);
      res.json(audio);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'TTS unavailable';
      const status = message === 'MISSING_API_KEY' ? 503 : getStatusCodeFromError(err) || 502;
      res.status(status).json({
        error: 'Gemini TTS unavailable',
        fallbackRecommended: true,
        detail: IS_PRODUCTION ? undefined : message.slice(0, 300),
      });
    }
  });

  const parseModelJson = (rawText: string): Record<string, unknown> => {
    const trimmed = rawText.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const cleaned = fenceMatch ? fenceMatch[1].trim() : trimmed;
    return JSON.parse(cleaned) as Record<string, unknown>;
  };

  async function runPronunciationAnalysis(
    ai: GoogleGenAI,
    targetText: string,
    mimeType: string,
    audioBase64: string,
  ) {
    const models = orderModelsByAvailability([
      'gemini-4-hydrogen',
      'gemini-3.1-flash-lite',
    ]);
    let lastError: unknown;

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      try {
        const response = await withRetry(
          () =>
            ai.models.generateContent({
              model,
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      inlineData: {
                        mimeType,
                        data: audioBase64,
                      },
                    },
                    {
                      text: `Target German text:\n"${targetText}"\n\nAnalyze the speaker's actual German pronunciation in the attached audio strictly against this target text and return the JSON result.`,
                    },
                  ],
                },
              ],
              config: {
                systemInstruction: PHONETICS_SYSTEM_INSTRUCTION,
                responseMimeType: 'application/json',
                responseSchema: ANALYSIS_RESPONSE_SCHEMA,
              },
            }),
          i === 0 ? 0 : 1,
        );

        const jsonText = (response.text ?? '').trim();
        if (!jsonText) {
          throw new Error('EMPTY_MODEL_RESPONSE');
        }
        return parseModelJson(jsonText);
      } catch (err) {
        lastError = err;
        recordModelCooldownIfNeeded(model, err);
        const status = getStatusCodeFromError(err);
        const shouldFallback =
          status === 404 || status === 503 || status === 429 || status === 500;
        if (!shouldFallback || i === models.length - 1) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[api/analyze] model=${model} status=${status ?? 'unknown'} error=${msg}`);
          throw err;
        }
      }
    }

    throw lastError ?? new Error('Analysis failed');
  }

  app.post('/api/analyze', async (req, res) => {
    const rawTargetText = req.body?.targetText;
    const rawAudioBase64 = req.body?.audioBase64;
    const rawMimeType = req.body?.mimeType;

    if (typeof rawTargetText !== 'string' || rawTargetText.trim().length === 0) {
      res.status(400).json({
        errorFa: 'ابتدا یک جمله یا واژه آلمانی بنویسید.',
      });
      return;
    }

    if (typeof rawAudioBase64 !== 'string' || rawAudioBase64.trim().length < 64) {
      res.status(400).json({
        errorFa: 'صدای ضبط‌شده معتبر نیست. لطفاً دوباره امتحان کنید.',
      });
      return;
    }

    const targetText = rawTargetText.trim().slice(0, 1000);
    const mimeType = sanitizeAudioMimeType(
      typeof rawMimeType === 'string' ? rawMimeType : 'audio/webm',
    );

    try {
      const ai = createGeminiClient();
      const parsed = await runPronunciationAnalysis(
        ai,
        targetText,
        mimeType,
        rawAudioBase64,
      );
      const normalized = normalizeAnalysisResult(targetText, parsed);
      res.json(normalized);
    } catch (err) {
      const status = getStatusCodeFromError(err);
      const errMessage = err instanceof Error ? err.message : String(err);
      const isMissingKey = errMessage === 'MISSING_API_KEY';

      if (isMissingKey || status === 403 || status === 400) {
        res.status(status || 503).json({
          errorFa: 'کلید سرویس تحلیل صوتی در تنظیمات برنامه در دسترس یا معتبر نیست.',
        });
        return;
      }

      if (status === 429) {
        res.status(429).json({
          errorFa:
            'سهمیه رایگان روزانه API پر شده است. می‌توانید چند دقیقه بعد امتحان کنید یا در Settings > Secrets کلید API دارای صورتحساب انتخاب کنید.',
        });
        return;
      }

      if (status === 503) {
        res.status(503).json({
          errorFa: 'سرویس تحلیل موقتاً شلوغ است. لطفاً چند ثانیه بعد دوباره امتحان کنید.',
        });
        return;
      }

      res.status(502).json({
        errorFa: 'تحلیل تلفظ با خطا روبه‌رو شد. لطفاً دوباره تلاش کنید.',
      });
    }
  });

  async function runTextJsonWithFallback(
    ai: GoogleGenAI,
    prompt: string,
    systemInstruction: string,
    responseSchema: Record<string, unknown>,
    routeLabel: string,
  ) {
    const models = orderModelsByAvailability([
      'gemini-3.1-flash-lite',
      'gemini-4-hydrogen',
    ]);
    let lastError: unknown;

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      try {
        const response = await withRetry(
          () =>
            ai.models.generateContent({
              model,
              contents: prompt,
              config: {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema,
              },
            }),
          i === 0 ? 0 : 1,
        );
        const jsonText = (response.text ?? '').trim();
        if (!jsonText) {
          throw new Error('EMPTY_MODEL_RESPONSE');
        }
        return parseModelJson(jsonText);
      } catch (err) {
        lastError = err;
        recordModelCooldownIfNeeded(model, err);
        const status = getStatusCodeFromError(err);
        const shouldFallback =
          status === 404 || status === 503 || status === 429 || status === 500;
        if (!shouldFallback || i === models.length - 1) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[${routeLabel}] model=${model} status=${status ?? 'unknown'} error=${msg}`);
          throw err;
        }
      }
    }

    throw lastError ?? new Error('Text generation failed');
  }

  app.post('/api/translate', async (req, res) => {
    const rawText = req.body?.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      res.status(400).json({ errorFa: 'ابتدا متنی به آلمانی بنویسید.' });
      return;
    }

    const cleanText = rawText.trim().slice(0, 1000);

    try {
      const ai = createGeminiClient();
      const parsed = await runTextJsonWithFallback(
        ai,
        `Translate this German text into natural, fluent Persian:\n"${cleanText}"`,
        'You are a precise German-to-Persian translator. Return ONLY the natural, idiomatic Persian translation with no extra commentary, notes, or parentheses unless essential.',
        TRANSLATION_RESPONSE_SCHEMA,
        'api/translate',
      );
      const translationFa = normalizeTranslationResult(parsed);
      if (!translationFa) {
        res.status(502).json({ errorFa: 'ترجمه دریافت نشد. لطفاً دوباره تلاش کنید.' });
        return;
      }
      res.json({ translationFa });
    } catch (err) {
      const status = getStatusCodeFromError(err);
      res.status(status === 429 ? 429 : 502).json({
        errorFa:
          status === 429
            ? 'محدودیت موقت درخواست‌ها پر شده است. چند لحظه بعد دوباره امتحان کنید.'
            : 'دریافت ترجمه با خطا روبه‌رو شد. لطفاً دوباره امتحان کنید.',
      });
    }
  });

  app.post('/api/examples', async (req, res) => {
    const rawText = req.body?.text;
    const cleanText = typeof rawText === 'string' ? rawText.trim().slice(0, 400) : '';

    if (!cleanText) {
      res.status(400).json({ errorFa: 'متن مرجع خالی است.' });
      return;
    }

    try {
      const ai = createGeminiClient();
      const parsed = await runTextJsonWithFallback(
        ai,
        `Based on this German input: "${cleanText}"\nCreate 3 to 4 natural, practical Standard German example sentences (A2–B2 level) that either use the key word/expression naturally or explore closely related everyday phrasing for pronunciation practice, each with a concise Persian translation. Do not repeat the exact input sentence.`,
        'You are a native German language coach creating clean, natural everyday German example sentences for pronunciation practice, paired with concise, natural Persian translations.',
        EXAMPLES_RESPONSE_SCHEMA,
        'api/examples',
      );
      const examples = normalizeExamplesResult(parsed);
      if (examples.length === 0) {
        res.status(502).json({ errorFa: 'مثالی دریافت نشد. لطفاً دوباره تلاش کنید.' });
        return;
      }
      res.json({ examples });
    } catch (err) {
      const status = getStatusCodeFromError(err);
      res.status(status === 429 ? 429 : 502).json({
        errorFa:
          status === 429
            ? 'محدودیت موقت درخواست‌ها پر شده است. چند لحظه بعد دوباره امتحان کنید.'
            : 'دریافت مثال‌ها با خطا روبه‌رو شد. لطفاً دوباره امتحان کنید.',
      });
    }
  });

  // Always return JSON for /api/* errors (e.g., payload too large or malformed JSON)
  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = getStatusCodeFromError(err) || 400;
    const isTooLarge = status === 413;
    res.status(status).json({
      errorFa: isTooLarge
        ? 'حجم فایل صوتی زیاد است. لطفاً جمله کوتاه‌تری ضبط کنید.'
        : 'درخواست ارسالی معتبر نبود. لطفاً دوباره امتحان کنید.',
    });
  });

  if (IS_PRODUCTION) {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Laut server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
