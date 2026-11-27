export type WordStatus = 'accurate' | 'imprecise' | 'mispronounced' | 'omitted';

export type IssueSeverity = 'mispronounced' | 'omitted' | 'imprecise';

export interface AnalyzedWord {
  word: string;
  status: WordStatus;
}

export interface PhoneticIssue {
  word: string;
  problemSubstring: string;
  severity: IssueSeverity;
  ipaTarget: string;
  explanationFa: string;
}

export interface PronunciationAnalysis {
  overallScore: number;
  speechDetected: boolean;
  words: AnalyzedWord[];
  issues: PhoneticIssue[];
}

export type PlaybackSpeed = 1 | 0.75;

export type RecorderState = 'idle' | 'recording' | 'analyzing';

export interface NoticeMessage {
  kind: 'info' | 'error';
  textFa: string;
}
