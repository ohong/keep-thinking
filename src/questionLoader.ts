import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Question } from "./types.js";

const QUESTION_BANK_PATH = path.resolve(
  fileURLToPath(new URL("../questions/naval-history.md", import.meta.url))
);

const QUESTION_BLOCK_REGEX = /### Question[\s\S]*?(?=\n---|$)/g;

export async function loadQuestions(): Promise<Question[]> {
  const raw = await fs.readFile(QUESTION_BANK_PATH, "utf8");
  const blocks = raw.match(QUESTION_BLOCK_REGEX) ?? [];

  const questions = blocks
    .map((block) => parseQuestionBlock(block))
    .filter((q): q is Question => Boolean(q));

  if (questions.length === 0) {
    throw new Error(`No questions parsed from ${QUESTION_BANK_PATH}`);
  }

  return questions;
}

function parseQuestionBlock(block: string): Question | null {
  const idMatch = block.match(/### Question\s+(?<id>\S+)/);
  const questionMatch = block.match(/Question:\s*(?<text>.+)/);
  const answerMatch = block.match(/Answer:\s*(?<answer>.+)/);
  const explanationMatch = block.match(/Explanation:\s*(?<explanation>[\s\S]+)/);

  if (!idMatch?.groups?.id || !questionMatch?.groups?.text || !answerMatch?.groups?.answer || !explanationMatch?.groups?.explanation) {
    return null;
  }

  const options = extractOptions(block);

  return {
    id: idMatch.groups.id.trim(),
    text: questionMatch.groups.text.trim(),
    options,
    correctAnswer: answerMatch.groups.answer.trim(),
    explanation: explanationMatch.groups.explanation.trim(),
  };
}

function extractOptions(block: string): string[] | undefined {
  const optionsMatch = block.match(/Options:\s*\n(?<options>[\s\S]*?)(?=\nAnswer:)/);
  if (!optionsMatch?.groups?.options) {
    return undefined;
  }

  const lines = optionsMatch.groups.options
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, ""));

  return lines.length > 0 ? lines : undefined;
}
