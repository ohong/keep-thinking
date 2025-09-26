import { Question, AnswerOutcome, ScoreSnapshot } from "./types.js";

function shuffle<T>(list: T[]): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class QuestionEngine {
  private readonly questions: Question[];

  private sequence: Question[] = [];

  private index = 0;

  private correct = 0;

  private total = 0;

  private active = false;

  constructor(questions: Question[]) {
    if (questions.length === 0) {
      throw new Error("QuestionEngine requires at least one question");
    }

    this.questions = questions;
  }

  start(): void {
    this.sequence = shuffle(this.questions);
    this.index = 0;
    this.correct = 0;
    this.total = 0;
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  getCurrentQuestion(): Question | null {
    if (!this.active || this.sequence.length === 0) {
      return null;
    }
    return this.sequence[this.index];
  }

  getScore(): ScoreSnapshot {
    return { correct: this.correct, total: this.total };
  }

  submitAnswer(rawInput: string): AnswerOutcome {
    if (!this.active) {
      throw new Error("Cannot submit answer while session is inactive");
    }

    const question = this.getCurrentQuestion();
    if (!question) {
      throw new Error("No active question available");
    }

    const submittedAnswer = rawInput.trim();
    const { normalizedSubmittedAnswer, normalizedCorrectAnswer, isCorrect } =
      this.evaluateAnswer(question, submittedAnswer);

    this.total += 1;
    if (isCorrect) {
      this.correct += 1;
    }

    this.index = (this.index + 1) % this.sequence.length;

    return {
      correct: isCorrect,
      submittedAnswer,
      normalizedSubmittedAnswer,
      normalizedCorrectAnswer,
      question,
    };
  }

  private evaluateAnswer(question: Question, submitted: string) {
    const normalizedSubmitted = submitted.toLowerCase();
    const normalizedCorrect = question.correctAnswer.trim().toLowerCase();

    if (question.options?.length) {
      const optionMap = buildOptionMap(question.options);
      const letter = extractLetter(normalizedSubmitted);

      if (letter && optionMap.has(letter)) {
        const correctLetter = resolveCorrectLetter(question.correctAnswer, optionMap);
        return {
          normalizedSubmittedAnswer: letter,
          normalizedCorrectAnswer: correctLetter,
          isCorrect: letter === correctLetter,
        };
      }

      const matchedOption = findOptionByText(optionMap, normalizedSubmitted);
      const correctLetter = resolveCorrectLetter(question.correctAnswer, optionMap);
      const correctText = optionMap.get(correctLetter) ?? question.correctAnswer.trim();

      return {
        normalizedSubmittedAnswer: matchedOption?.letter ?? normalizedSubmitted,
        normalizedCorrectAnswer: correctLetter,
        isCorrect:
          matchedOption?.letter === correctLetter ||
          normalizeText(matchedOption?.text ?? "") === normalizeText(correctText),
      };
    }

    if (isBooleanAnswer(normalizedCorrect)) {
      const normalizedBoolean = normalizeBooleanResponse(normalizedSubmitted);
      const expected = normalizeBooleanResponse(normalizedCorrect);
      return {
        normalizedSubmittedAnswer: normalizedBoolean,
        normalizedCorrectAnswer: expected,
        isCorrect: normalizedBoolean === expected,
      };
    }

    return {
      normalizedSubmittedAnswer: normalizedSubmitted,
      normalizedCorrectAnswer: normalizedCorrect,
      isCorrect: normalizeText(normalizedSubmitted) === normalizeText(normalizedCorrect),
    };
  }
}

function buildOptionMap(options: string[]) {
  const map = new Map<string, string>();
  options.forEach((option) => {
    const trimmed = option.trim();
    const match = trimmed.match(/^(?<letter>[A-Z])\)?\s*(?<text>.*)$/i);
    if (match?.groups?.letter) {
      const letter = match.groups.letter.toUpperCase();
      const text = match.groups.text?.trim() ?? "";
      map.set(letter, text.length > 0 ? text : trimmed);
    }
  });
  return map;
}

function extractLetter(input: string): string | undefined {
  const match = input.match(/^[a-z]/i);
  return match ? match[0].toUpperCase() : undefined;
}

function resolveCorrectLetter(answer: string, map: Map<string, string>): string {
  const normalized = answer.trim().toUpperCase();
  if (map.has(normalized)) {
    return normalized;
  }

  const normalizedText = normalizeText(answer);
  for (const [letter, text] of map.entries()) {
    if (normalizeText(text) === normalizedText) {
      return letter;
    }
  }

  return normalized;
}

function findOptionByText(
  map: Map<string, string>,
  normalizedSubmitted: string
): { letter: string; text: string } | undefined {
  for (const [letter, text] of map.entries()) {
    if (normalizeText(text) === normalizeText(normalizedSubmitted)) {
      return { letter, text };
    }
  }
  return undefined;
}

function normalizeText(text: string): string {
  return text.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isBooleanAnswer(answer: string): boolean {
  const normalized = normalizeBooleanResponse(answer);
  return normalized === "true" || normalized === "false";
}

function normalizeBooleanResponse(value: string): "true" | "false" {
  const trimmed = value.trim().toLowerCase();
  if (["true", "t", "yes", "y", "1"].includes(trimmed)) {
    return "true";
  }
  return "false";
}
