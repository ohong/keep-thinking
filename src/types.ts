export interface Question {
  id: string;
  text: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
}

export interface AnswerOutcome {
  correct: boolean;
  submittedAnswer: string;
  normalizedSubmittedAnswer: string;
  normalizedCorrectAnswer: string;
  question: Question;
}

export interface ScoreSnapshot {
  correct: number;
  total: number;
}

export interface SessionEventPayload {
  sessionFile: string;
  timestamp: Date;
}
