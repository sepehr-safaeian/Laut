/**
 * Pure audio buffer helpers for ensuring Gemini TTS responses are valid WAV audio.
 * Gemini 2.5 Flash Preview TTS returns raw 24kHz 16-bit mono PCM (L16),
 * whereas Gemini 3.8 TTS unary calls return a complete RIFF WAV file.
 */

export function isRiffWav(buffer: Uint8Array): boolean {
  if (buffer.length < 12) return false;
  const riff =
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46;
  const wave =
    buffer[8] === 0x57 &&
    buffer[9] === 0x41 &&
    buffer[10] === 0x56 &&
    buffer[11] === 0x45;
  return riff && wave;
}

export function parseSampleRateFromMimeType(
  mimeType: string | undefined,
  defaultRate = 24000,
): number {
  if (!mimeType) return defaultRate;
  const match = mimeType.match(/rate=(\d+)/i);
  if (!match) return defaultRate;
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed < 8000 || parsed > 96000) {
    return defaultRate;
  }
  return parsed;
}

export function wrapPcmAsWav(
  pcmData: Uint8Array,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16,
): Uint8Array {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.byteLength;
  const wav = new Uint8Array(44 + dataSize);
  const view = new DataView(wav.buffer);

  // "RIFF"
  wav.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, 36 + dataSize, true);
  // "WAVE"
  wav.set([0x57, 0x41, 0x56, 0x45], 8);
  // "fmt "
  wav.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true); // Subchunk1Size (PCM)
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // "data"
  wav.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, dataSize, true);
  wav.set(pcmData, 44);

  return wav;
}

export function ensureWavBytes(
  rawBytes: Uint8Array,
  mimeType?: string,
): Uint8Array {
  if (isRiffWav(rawBytes)) {
    return rawBytes;
  }
  const sampleRate = parseSampleRateFromMimeType(mimeType, 24000);
  return wrapPcmAsWav(rawBytes, sampleRate, 1, 16);
}
