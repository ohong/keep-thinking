#!/usr/bin/env node
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { existsSync, readdirSync, statSync, watch, FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Ensure Ink receives a callable reconciler default export, even on Node releases
 * where CJS interop returns an object instead of the legacy function shape.
 */
const require = createRequire(import.meta.url);

const ensureReactReconcilerCompatibility = async () => {
  const moduleNamespace = await import("react-reconciler");
  const maybeFunction =
    typeof moduleNamespace === "function"
      ? moduleNamespace
      : typeof moduleNamespace.default === "function"
        ? moduleNamespace.default
        : typeof (moduleNamespace as Record<string, unknown>)["module.exports"] === "function"
          ? ((moduleNamespace as Record<string, unknown>)["module.exports"] as (...args: unknown[]) => unknown)
          : null;

  if (typeof maybeFunction === "function") {
    // If Node already returned a function default nothing else to do.
    if (typeof moduleNamespace.default === "function") {
      return;
    }

    // Otherwise, patch both `default` and the CommonJS mirror so downstream imports see the function.
    (moduleNamespace as Record<string, unknown>).default = maybeFunction;
    (moduleNamespace as Record<string, unknown>)["module.exports"] = maybeFunction;
    return;
  }

  // Fall back to requiring the known CJS build directly.
  try {
    const env = process.env.NODE_ENV === "production" ? "production.min" : "development";
    const reconciler = require(`react-reconciler/cjs/react-reconciler.${env}.js`);
    if (typeof reconciler === "function") {
      (moduleNamespace as Record<string, unknown>).default = reconciler;
      (moduleNamespace as Record<string, unknown>)["module.exports"] = reconciler;
    }
  } catch (_error) {
    // Ignore; Ink will surface a clearer error if this fails.
  }
};

await ensureReactReconcilerCompatibility();

const inkModule = await import("ink");
const { render, Box, Text, useApp, useInput } = inkModule;

/**
 * Question data structures
 */
interface QuestionOption {
  label: string;
  text: string;
}

type QuestionType = "multiple-choice" | "true-false" | "short-answer";

interface Question {
  id: string;
  prompt: string;
  type: QuestionType;
  options: QuestionOption[];
  answerKey: string;
  answerDisplay: string;
  explanation: string;
}

interface ParsedQuestionBlock {
  id: string;
  question: string;
  options: QuestionOption[];
  answer: string;
  explanation: string;
}

interface QuestionBank {
  id: string;
  title: string;
  questions: Question[];
}

/**
 * Claude session message definitions (subset of what we need)
 */
interface MessageContent {
  type: string;
  text?: string;
}

interface MessageUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface SessionMessage {
  id?: string;
  role?: string;
  type?: string;
  model?: string;
  usage?: MessageUsage;
  content?: MessageContent[];
}

interface MessageData {
  message?: SessionMessage;
  timestamp?: string;
}

/**
 * Keep Thinking Logo Component
 */
const KeepThinkingLogo = ({ bannerText }: { bannerText?: string }) => (
  <Box marginTop={2} marginBottom={2} flexDirection="column" alignItems="center">
    <Text color="red" bold>
      {`██╗  ██╗███████╗███████╗██████╗ \n`}
      {`██║ ██╔╝██╔════╝██╔════╝██╔══██╗\n`}
      {`█████╔╝ █████╗  █████╗  ██████╔╝\n`}
      {`██╔═██╗ ██╔══╝  ██╔══╝  ██╔═══╝ \n`}
      {`██║  ██╗███████╗███████╗██║     \n`}
      {`╚═╝  ╚═╝╚══════╝╚══════╝╚═╝     \n`}
      {`                                 `}
    </Text>
    <Text color="green" bold>
      {`████████╗██╗  ██╗██╗███╗   ██╗██╗  ██╗██╗███╗   ██╗ ██████╗ \n`}
      {`╚══██╔══╝██║  ██║██║████╗  ██║██║ ██╔╝██║████╗  ██║██╔════╝ \n`}
      {`   ██║   ███████║██║██╔██╗ ██║█████╔╝ ██║██╔██╗ ██║██║  ███╗\n`}
      {`   ██║   ██╔══██║██║██║╚██╗██║██╔═██╗ ██║██║╚██╗██║██║   ██║\n`}
      {`   ██║   ██║  ██║██║██║ ╚████║██║  ██╗██║██║ ╚████║╚██████╔╝\n`}
      {`   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝ `}
    </Text>
    <Text color="gray" dimColor>
      {bannerText || "https://github.com/ohong/keep-thinking"}
    </Text>
  </Box>
);

/**
 * Utility helpers
 */
const QUESTION_DIR = path.join(__dirname, "questions");
const DEFAULT_BANK_ID = "ml-basics";

const QUESTION_SEPARATOR = /\n---\n/g;

const UUID_FILENAME_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

const DEFAULT_STATUS_BAR = {
  active: "Time to be usefully distracted",
  idle: "Get busy coding",
};

const FEEDBACK_ADVANCE_DELAY_MS = 800;

const formatDuration = (milliseconds: number) => {
  const safeMs = Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const normalizeShortAnswer = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");

const shuffle = <T,>(items: T[]): T[] => {
  const clone = [...items];
  for (let i = clone.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
};

/**
 * Question parsing
 */
const parseQuestionBlocks = (content: string): ParsedQuestionBlock[] => {
  const blocks = content.split(QUESTION_SEPARATOR).map(block => block.trim());
  const parsed: ParsedQuestionBlock[] = [];

  for (const block of blocks) {
    if (!block) continue;

    const idMatch = block.match(/###\s+Question\s+(.+)/i);
    const id = idMatch ? idMatch[1].trim() : `Q${parsed.length + 1}`;

    const questionLineMatch = block.match(/Question:\s*([\s\S]+?)(?:\n[A-Z][a-zA-Z ]*?:|$)/);
    const question = questionLineMatch ? questionLineMatch[1].trim() : "";

    if (!question) continue;

    let options: QuestionOption[] = [];
    const optionsSectionMatch = block.match(/Options:\s*\n([\s\S]+?)(?:\nAnswer:|$)/i);
    if (optionsSectionMatch) {
      const optionLines = optionsSectionMatch[1]
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean);

      options = optionLines
        .map(line => {
          const optionMatch = line.match(/^-\s*([A-Za-z])\)\s*(.+)$/);
          if (!optionMatch) return null;
          return {
            label: optionMatch[1].toUpperCase(),
            text: optionMatch[2].trim(),
          } satisfies QuestionOption;
        })
        .filter((item): item is QuestionOption => Boolean(item));
    }

    const answerMatch = block.match(/Answer:\s*([^\n]+)/i);
    const explanationMatch = block.match(/Explanation:\s*([\s\S]+)/i);

    const answer = answerMatch ? answerMatch[1].trim() : "";
    const explanation = explanationMatch ? explanationMatch[1].trim() : "";

    if (!answer) continue;

    parsed.push({ id, question, options, answer, explanation });
  }

  return parsed;
};

const toQuestion = (block: ParsedQuestionBlock): Question => {
  const trimmedAnswer = block.answer.trim();
  const uppercaseAnswer = trimmedAnswer.toUpperCase();

  if (block.options.length > 0) {
    const matchedOption = block.options.find(
      option => option.label.toUpperCase() === uppercaseAnswer,
    );

    const answerDisplay = matchedOption
      ? `${matchedOption.label}) ${matchedOption.text}`
      : `${uppercaseAnswer})`;

    return {
      id: block.id,
      prompt: block.question,
      type: "multiple-choice",
      options: block.options,
      answerKey: uppercaseAnswer,
      answerDisplay,
      explanation: block.explanation,
    } satisfies Question;
  }

  const lowerAnswer = trimmedAnswer.toLowerCase();
  if (lowerAnswer === "true" || lowerAnswer === "false") {
    const normalized = lowerAnswer === "true" ? "true" : "false";
    const answerDisplay = normalized === "true" ? "True" : "False";

    return {
      id: block.id,
      prompt: block.question,
      type: "true-false",
      options: [
        { label: "T", text: "True" },
        { label: "F", text: "False" },
      ],
      answerKey: normalized,
      answerDisplay,
      explanation: block.explanation,
    } satisfies Question;
  }

  const answerDisplay = block.answer.trim();
  return {
    id: block.id,
    prompt: block.question,
    type: "short-answer",
    options: [],
    answerKey: normalizeShortAnswer(answerDisplay),
    answerDisplay,
    explanation: block.explanation,
  } satisfies Question;
};

const toTitleCase = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const loadQuestionBanks = async (): Promise<QuestionBank[]> => {
  if (!existsSync(QUESTION_DIR)) {
    throw new Error(`Question directory not found at ${QUESTION_DIR}`);
  }

  const entries = readdirSync(QUESTION_DIR).filter(entry => entry.endsWith(".md"));

  const banks: QuestionBank[] = [];
  for (const entry of entries) {
    const fullPath = path.join(QUESTION_DIR, entry);
    const content = await readFile(fullPath, "utf-8");
    const parsedBlocks = parseQuestionBlocks(content);
    if (parsedBlocks.length === 0) {
      continue;
    }

    const fileId = path.parse(entry).name;
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const derivedTitle = titleMatch ? titleMatch[1].trim() : toTitleCase(fileId.replace(/[-_]+/g, " "));
    const questions = parsedBlocks.map(toQuestion);

    if (questions.length === 0) {
      continue;
    }

    banks.push({ id: fileId, title: derivedTitle, questions });
  }

  if (banks.length === 0) {
    throw new Error("No question banks found in the question directory");
  }

  return banks;
};

/**
 * Claude session monitoring
 */
interface SessionRecord {
  status: "ACTIVE" | "INACTIVE";
  filePath: string;
  projectPath: string;
  lastMessage?: MessageData | null;
}

interface SessionFileDescriptor {
  sessionId: string;
  filePath: string;
  projectPath: string;
}

type MonitorUpdate =
  | { type: "ready"; activeSessions: number }
  | { type: "active"; activeSessions: number }
  | { type: "inactive"; activeSessions: number }
  | { type: "error"; message: string };

type MonitorListener = (update: MonitorUpdate) => void;

class ClaudeSessionMonitor {
  private sessions = new Map<string, SessionRecord>();
  private watchers: FSWatcher[] = [];
  private listeners = new Set<MonitorListener>();
  private claudePaths: string[] = [];
  private started = false;
  private lastActiveState = false;
  private lastActiveCount = 0;

  subscribe(listener: MonitorListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(update: MonitorUpdate) {
    for (const listener of this.listeners) {
      listener(update);
    }
  }

  private getClaudePaths() {
    const paths: string[] = [];
    const envPaths = (process.env.CLAUDE_CONFIG_DIR || "")
      .split(",")
      .map(entry => entry.trim())
      .filter(Boolean);

    for (const envPath of envPaths) {
      const projectsDir = path.join(envPath, "projects");
      if (existsSync(projectsDir)) {
        paths.push(envPath);
      }
    }

    const defaultCandidates = [
      path.join(homedir(), ".config", "claude"),
      path.join(homedir(), ".claude"),
    ];

    for (const candidate of defaultCandidates) {
      const projectsDir = path.join(candidate, "projects");
      if (existsSync(projectsDir)) {
        paths.push(candidate);
      }
    }

    return [...new Set(paths)];
  }

  private isUuidFilename(filename: string) {
    return UUID_FILENAME_REGEX.test(filename);
  }

  private findAllSessions(): SessionFileDescriptor[] {
    const descriptors: SessionFileDescriptor[] = [];

    for (const claudePath of this.claudePaths) {
      const projectsDir = path.join(claudePath, "projects");
      if (!existsSync(projectsDir)) continue;

      const projectEntries = readdirSync(projectsDir);
      for (const projectEntry of projectEntries) {
        const projectPath = path.join(projectsDir, projectEntry);
        try {
          if (!statSync(projectPath).isDirectory()) continue;
        } catch {
          continue;
        }

        let fileEntries: string[] = [];
        try {
          fileEntries = readdirSync(projectPath);
        } catch {
          continue;
        }

        for (const fileEntry of fileEntries) {
          if (!fileEntry.endsWith(".jsonl") || !this.isUuidFilename(fileEntry)) continue;
          const filePath = path.join(projectPath, fileEntry);
          const sessionId = fileEntry.replace(/\.jsonl$/, "");
          descriptors.push({ sessionId, filePath, projectPath: projectEntry });
        }
      }
    }

    return descriptors;
  }

  private async parseLastMessage(filePath: string): Promise<MessageData | null> {
    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content
        .trim()
        .split(/\r?\n/)
        .filter(line => line.length > 0);

      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];
        try {
          const data = JSON.parse(line);
          if (data && data.message) {
            return data as MessageData;
          }
        } catch {
          /* ignore parse errors */
        }
      }
    } catch {
      // ignore read errors
    }

    return null;
  }

  private isActiveMessage(messageData: MessageData | null): boolean {
    if (!messageData || !messageData.message) return false;

    const message = messageData.message;
    const timestamp = new Date(messageData.timestamp || "").getTime();
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    if (!Number.isFinite(timestamp) || timestamp < fiveMinutesAgo) {
      return false;
    }

    if (message.role === "assistant" && message.type === "message") {
      const hasToolUse = message.content?.some(item => item.type === "tool_use");
      if (hasToolUse) {
        return true;
      }

      const textContent = message.content?.find(item => item.type === "text");
      const text = textContent?.text?.trim() || "";
      if (text) {
        const triggers = [
          /^now i\b/i,
          /^now i'll/i,
          /^i'll\b/i,
          /^now let/i,
          /let me/i,
          /i need/i,
        ];
        if (triggers.some(regex => regex.test(text))) {
          return true;
        }
      }

      return false;
    }

    return true;
  }

  private getActiveCount() {
    let activeCount = 0;
    for (const session of this.sessions.values()) {
      if (session.status === "ACTIVE") {
        activeCount += 1;
      }
    }
    return activeCount;
  }

  private emitStateChange(force = false) {
    const activeCount = this.getActiveCount();
    const isActive = activeCount > 0;

    if (force || isActive !== this.lastActiveState || activeCount !== this.lastActiveCount) {
      this.lastActiveState = isActive;
      this.lastActiveCount = activeCount;
      this.notify({ type: isActive ? "active" : "inactive", activeSessions: activeCount });
    }
  }

  private async updateSessionState(
    sessionId: string,
    filePath: string,
    projectPath: string,
  ) {
    const lastMessage = await this.parseLastMessage(filePath);
    const isActive = this.isActiveMessage(lastMessage);

    this.sessions.set(sessionId, {
      status: isActive ? "ACTIVE" : "INACTIVE",
      filePath,
      projectPath,
      lastMessage,
    });
  }

  private async updateSession(
    sessionId: string,
    filePath: string,
    projectPath: string,
  ) {
    await this.updateSessionState(sessionId, filePath, projectPath);
    this.emitStateChange();
  }

  private registerWatcher(dirPath: string) {
    try {
      const watcher = watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const relative = typeof filename === "string" ? filename : filename.toString();
        if (!relative.endsWith(".jsonl")) return;

        const fullPath = path.join(dirPath, relative);
        const filenameOnly = path.basename(fullPath);
        if (!this.isUuidFilename(filenameOnly)) return;

        const sessionId = filenameOnly.replace(/\.jsonl$/, "");
        const projectPath = path.basename(path.dirname(fullPath));

        void this.updateSession(sessionId, fullPath, projectPath);
      });

      watcher.on("error", error => {
        this.notify({ type: "error", message: `Watcher error: ${error.message}` });
      });

      this.watchers.push(watcher);
    } catch (error) {
      if (error instanceof Error) {
        this.notify({ type: "error", message: error.message });
      } else {
        this.notify({ type: "error", message: "Unknown watcher error" });
      }
    }
  }

  private async initialScan() {
    const descriptors = this.findAllSessions();
    for (const descriptor of descriptors) {
      await this.updateSessionState(descriptor.sessionId, descriptor.filePath, descriptor.projectPath);
    }
    this.emitStateChange(true);
  }

  async start() {
    if (this.started) return;
    this.started = true;

    this.claudePaths = this.getClaudePaths();
    if (this.claudePaths.length === 0) {
      this.notify({
        type: "error",
        message: "No Claude data directories found. Launch Claude Code at least once to initialize.",
      });
      return;
    }

    await this.initialScan();

    for (const claudePath of this.claudePaths) {
      const projectsDir = path.join(claudePath, "projects");
      if (existsSync(projectsDir)) {
        this.registerWatcher(projectsDir);
      }
    }

    this.notify({ type: "ready", activeSessions: this.lastActiveCount });
  }

  stop() {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    this.started = false;
    this.sessions.clear();
  }
}

/**
 * Quiz evaluation helpers
 */

type EvaluationStatus = "correct" | "incorrect" | "invalid";

interface EvaluationResult {
  status: EvaluationStatus;
  message?: string;
}

const evaluateAnswer = (question: Question, rawInput: string): EvaluationResult => {
  const input = rawInput.trim();
  if (!input) {
    return { status: "invalid", message: "Enter an answer before submitting." };
  }

  if (question.type === "multiple-choice") {
    const normalized = input.replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase();
    if (!normalized) {
      return {
        status: "invalid",
        message: `Choose one of ${question.options.map(option => option.label).join(", ")}.`,
      };
    }

    const optionLabels = question.options.map(option => option.label.toUpperCase());
    if (!optionLabels.includes(normalized)) {
      return {
        status: "invalid",
        message: `Valid options are ${optionLabels.join(", ")}.`,
      };
    }

    return {
      status: normalized === question.answerKey.toUpperCase() ? "correct" : "incorrect",
    };
  }

  if (question.type === "true-false") {
    const normalized = input.toLowerCase();
    let interpreted: string | null = null;
    if (["t", "true", "y", "yes"].includes(normalized)) {
      interpreted = "true";
    } else if (["f", "false", "n", "no"].includes(normalized)) {
      interpreted = "false";
    }

    if (!interpreted) {
      return {
        status: "invalid",
        message: "Answer with T/True or F/False.",
      };
    }

    return {
      status: interpreted === question.answerKey ? "correct" : "incorrect",
    };
  }

  const normalizedInput = normalizeShortAnswer(input);
  if (!normalizedInput) {
    return { status: "invalid", message: "Enter a response." };
  }

  const normalizedAnswer = question.answerKey;
  const matchesExactly = normalizedInput === normalizedAnswer;
  const containsMatch =
    normalizedAnswer.includes(normalizedInput) || normalizedInput.includes(normalizedAnswer);

  const status: EvaluationStatus = matchesExactly || containsMatch ? "correct" : "incorrect";
  return { status };
};

const formatSubmittedAnswer = (question: Question, rawInput: string) => {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return "(no answer)";
  }

  if (question.type === "multiple-choice") {
    const normalized = trimmed.replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase();
    const option = question.options.find(item => item.label.toUpperCase() === normalized);
    if (option) {
      return `${option.label}) ${option.text}`;
    }
    return normalized || trimmed;
  }

  if (question.type === "true-false") {
    const normalized = trimmed.toLowerCase();
    if (["t", "true", "y", "yes"].includes(normalized)) {
      return "True";
    }
    if (["f", "false", "n", "no"].includes(normalized)) {
      return "False";
    }
  }

  return trimmed;
};

/**
 * Ink UI
 */
interface FeedbackState {
  type: "success" | "error" | "info";
  heading: string;
  questionId: string;
  userAnswer: string;
  correctAnswer?: string;
  explanation?: string;
  detail?: string;
}

const App: React.FC = () => {
  const { exit } = useApp();
  const monitorRef = useRef<ClaudeSessionMonitor | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const advanceDelayRef = useRef<NodeJS.Timeout | null>(null);
  const previousActiveRef = useRef(false);
  const questionOrderRef = useRef<number[]>([]);

  const [questionBanks, setQuestionBanks] = useState<QuestionBank[]>([]);
  const [activeQuestions, setActiveQuestions] = useState<Question[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [questionOrder, setQuestionOrder] = useState<number[]>([]);
  const [questionCursor, setQuestionCursor] = useState(0);
  const [sessionActive, setSessionActive] = useState(false);
  const [activeSessionsCount, setActiveSessionsCount] = useState(0);
  const [monitorStatus, setMonitorStatus] = useState<"pending" | "ready" | "error">("pending");
  const [monitorMessage, setMonitorMessage] = useState<string | null>(null);
  const [answerInput, setAnswerInput] = useState("");
  const [askedCount, setAskedCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sessionCompletedMessage, setSessionCompletedMessage] = useState<string | null>(null);
  const [awaitingAdvance, setAwaitingAdvance] = useState(false);
  const [advanceEnabled, setAdvanceEnabled] = useState(false);
  const [quizRunning, setQuizRunning] = useState(false);
  const [autoStartEnabled, setAutoStartEnabled] = useState(true);

  const clearAdvanceDelay = useCallback(() => {
    if (advanceDelayRef.current) {
      clearTimeout(advanceDelayRef.current);
      advanceDelayRef.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetQuizState = useCallback(
    (options?: { message?: string; preserveBank?: boolean }) => {
      const { message = null, preserveBank = false } = options ?? {};
      stopTimer();
      clearAdvanceDelay();
      questionOrderRef.current = [];
      setQuestionOrder([]);
      setQuestionCursor(0);
      setAskedCount(0);
      setCorrectCount(0);
      setAnswerInput("");
      setFeedback(null);
      setAwaitingAdvance(false);
      setAdvanceEnabled(false);
      setSessionStart(null);
      setElapsedMs(0);
      setQuizRunning(false);
      if (!preserveBank) {
        setActiveQuestions([]);
        setSelectedBankId(null);
      }
      setSessionCompletedMessage(message);
    },
    [clearAdvanceDelay, stopTimer],
  );

  const shutdown = useCallback(() => {
    stopTimer();
    clearAdvanceDelay();
    monitorRef.current?.stop();
    exit();
  }, [clearAdvanceDelay, exit, stopTimer]);

  const selectedBank = useMemo(
    () => questionBanks.find(bank => bank.id === selectedBankId) ?? null,
    [questionBanks, selectedBankId],
  );

  const defaultQuizTitle = useMemo(() => {
    const preferred =
      questionBanks.find(bank => bank.id === DEFAULT_BANK_ID) ?? questionBanks[0] ?? null;
    return preferred?.title ?? "Loading question set...";
  }, [questionBanks]);

  const currentQuestion = useMemo(() => {
    if (!activeQuestions.length || !questionOrder.length) return null;
    const normalizedCursor = questionCursor % questionOrder.length;
    const questionIndex = questionOrder[normalizedCursor];
    return activeQuestions[questionIndex];
  }, [activeQuestions, questionOrder, questionCursor]);

  const activateBank = useCallback(
    (bank: QuestionBank) => {
      if (!sessionActive) return;
      if (!bank.questions.length) return;

      setSelectedBankId(bank.id);
      setActiveQuestions(bank.questions);
      const order = shuffle([...bank.questions.keys()]);
      questionOrderRef.current = order;
      setQuestionOrder(order);
      setQuestionCursor(0);
      setAskedCount(0);
      setCorrectCount(0);
      setFeedback(null);
      setAnswerInput("");
      setAwaitingAdvance(false);
      setAdvanceEnabled(false);
      clearAdvanceDelay();
      setQuizRunning(true);
      setAutoStartEnabled(true);
      setSessionCompletedMessage(null);

      const startTime = Date.now();
      setSessionStart(startTime);
      setElapsedMs(0);

      stopTimer();
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTime);
      }, 1000);
    },
    [clearAdvanceDelay, sessionActive, stopTimer],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadQuestionBanks();
        if (!cancelled) {
          setQuestionBanks(loaded);
        }
      } catch (error) {
        if (!cancelled) {
          setMonitorStatus("error");
          const message =
            error instanceof Error ? error.message : "Failed to load question bank.";
          setMonitorMessage(message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const monitor = new ClaudeSessionMonitor();
    monitorRef.current = monitor;

    const unsubscribe = monitor.subscribe(update => {
      switch (update.type) {
        case "ready":
          setMonitorStatus(prev => (prev === "error" ? prev : "ready"));
          setActiveSessionsCount(update.activeSessions);
          break;
        case "active":
          setMonitorStatus("ready");
          setActiveSessionsCount(update.activeSessions);
          setSessionActive(true);
          break;
        case "inactive":
          setMonitorStatus("ready");
          setActiveSessionsCount(update.activeSessions);
          setSessionActive(false);
          break;
        case "error":
          setMonitorStatus("error");
          setMonitorMessage(update.message);
          break;
        default:
          break;
      }
    });

    void monitor.start();

    return () => {
      unsubscribe();
      monitor.stop();
    };
  }, []);

  useEffect(() => {
    questionOrderRef.current = questionOrder;
  }, [questionOrder]);

  useEffect(() => {
    const justActivated = sessionActive && !previousActiveRef.current;
    const justDeactivated = !sessionActive && previousActiveRef.current;

    if (justActivated) {
      if (!quizRunning) {
        resetQuizState();
      }
      setAutoStartEnabled(true);
    }

    if (justDeactivated) {
      if (quizRunning) {
        setSessionCompletedMessage("Claude Code task complete - return to your session");
      } else {
        resetQuizState({ message: "Claude Code task complete - return to your session" });
      }
      setAutoStartEnabled(true);
    }

    previousActiveRef.current = sessionActive;
  }, [quizRunning, resetQuizState, sessionActive]);

  useEffect(() => {
    if (!sessionActive) return;
    if (!autoStartEnabled) return;
    if (quizRunning) return;
    if (selectedBankId) return;
    if (!questionBanks.length) return;

    const preferredBank =
      questionBanks.find(bank => bank.id === DEFAULT_BANK_ID) ?? questionBanks[0] ?? null;

    if (preferredBank) {
      activateBank(preferredBank);
    }
  }, [activateBank, autoStartEnabled, questionBanks, quizRunning, selectedBankId, sessionActive]);

  useEffect(() => {
    return () => {
      stopTimer();
      clearAdvanceDelay();
    };
  }, [clearAdvanceDelay, stopTimer]);

  const advanceToNextQuestion = useCallback(() => {
    clearAdvanceDelay();
    setAwaitingAdvance(false);
    setAdvanceEnabled(false);
    setFeedback(null);
    setAnswerInput("");
    setQuestionCursor(previous => {
      const order = questionOrderRef.current;
      if (!order.length) return previous;
      return (previous + 1) % order.length;
    });
  }, [clearAdvanceDelay]);

  const handleManualEnd = useCallback(() => {
    setAutoStartEnabled(false);
    resetQuizState({ message: "Quiz ended. Start a new Claude Code session to begin again." });
  }, [resetQuizState]);

  const handleSubmit = useCallback(
    (rawInput: string) => {
      if (!quizRunning || !currentQuestion || awaitingAdvance) return;

      setSessionCompletedMessage(null);
      const evaluation = evaluateAnswer(currentQuestion, rawInput);
      const userAnswerDisplay = formatSubmittedAnswer(currentQuestion, rawInput);
      const invalidDetail =
        currentQuestion.type === "multiple-choice"
          ? "Choose one of the listed options before submitting."
          : currentQuestion.type === "true-false"
            ? "Answer with T (True) or F (False)."
            : "Enter a response before submitting.";
      if (evaluation.status === "invalid") {
        setFeedback({
          type: "info",
          heading: evaluation.message || "Invalid answer.",
          detail: invalidDetail,
          questionId: currentQuestion.id,
          userAnswer: userAnswerDisplay,
        });
        return;
      }

      setAskedCount(previous => previous + 1);
      setAwaitingAdvance(true);
      setAdvanceEnabled(false);
      clearAdvanceDelay();
      advanceDelayRef.current = setTimeout(() => {
        setAdvanceEnabled(true);
        advanceDelayRef.current = null;
      }, FEEDBACK_ADVANCE_DELAY_MS);

      if (evaluation.status === "correct") {
        setCorrectCount(previous => previous + 1);
        setFeedback({
          type: "success",
          heading: "✓ Correct!",
          questionId: currentQuestion.id,
          userAnswer: userAnswerDisplay,
          correctAnswer: currentQuestion.answerDisplay,
          explanation: currentQuestion.explanation,
        });
      } else {
        setFeedback({
          type: "error",
          heading: "✗ Incorrect.",
          questionId: currentQuestion.id,
          userAnswer: userAnswerDisplay,
          correctAnswer: currentQuestion.answerDisplay,
          explanation: currentQuestion.explanation,
        });
      }
    },
    [awaitingAdvance, clearAdvanceDelay, currentQuestion, quizRunning],
  );

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      shutdown();
      return;
    }

    if (key.return) {
      const raw = answerInput;
      const normalizedCommand = raw.trim().toLowerCase();
      if (normalizedCommand === "/exit") {
        shutdown();
        return;
      }
      if (normalizedCommand === "/end") {
        handleManualEnd();
        return;
      }
    }

    if (awaitingAdvance) {
      if (key.return && advanceEnabled) {
        advanceToNextQuestion();
      }
      return;
    }

    if (!quizRunning || !currentQuestion) {
      return;
    }

    if (key.return) {
      handleSubmit(answerInput);
      return;
    }

    if (key.backspace || key.delete) {
      setAnswerInput(value => value.slice(0, -1));
      return;
    }

    if (currentQuestion.type === "multiple-choice") {
      if (answerInput.startsWith("/")) {
        if (input) {
          setAnswerInput(value => value + input);
        }
        return;
      }

      if (input === "/") {
        setAnswerInput("/");
        return;
      }

      const normalized = input.replace(/[^A-Za-z]/g, "").toUpperCase();
      if (normalized.length === 1) {
        setAnswerInput(normalized);
      }
      return;
    }

    if (currentQuestion.type === "true-false") {
      if (answerInput.startsWith("/")) {
        if (input) {
          setAnswerInput(value => value + input);
        }
        return;
      }

      if (input === "/") {
        setAnswerInput("/");
        return;
      }

      const normalized = input.toLowerCase();
      if (["t", "y", "f", "n"].includes(normalized)) {
        const value = normalized === "y" ? "T" : normalized === "n" ? "F" : normalized.toUpperCase();
        setAnswerInput(value);
      }
      return;
    }

    if (input) {
      setAnswerInput(value => value + input);
    }
  });

  const statusText = quizRunning ? DEFAULT_STATUS_BAR.active : DEFAULT_STATUS_BAR.idle;
  const statusColor = quizRunning ? "green" : "cyan";

  const timerDisplay = quizRunning && sessionStart ? formatDuration(elapsedMs) : "--:--";
  const liveAnswerPreview = answerInput
    ? answerInput
    : awaitingAdvance
      ? "Answer submitted"
      : "—";
  const liveAnswerColor = awaitingAdvance ? "cyan" : answerInput ? "white" : "gray";

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
      <KeepThinkingLogo />
      <Box justifyContent="space-between">
        <Text color={statusColor}>{statusText}</Text>
        <Text color="yellow">Timer: {timerDisplay}</Text>
      </Box>

      <Box justifyContent="space-between">
        <Text color="magenta">Claude sessions: {activeSessionsCount}</Text>
        <Text color="blue">Score: {correctCount}/{askedCount}</Text>
      </Box>

      <Text color="cyan">Quiz: {selectedBank ? selectedBank.title : defaultQuizTitle}</Text>

      {sessionCompletedMessage && quizRunning && (
        <Text color="green">{sessionCompletedMessage}</Text>
      )}

      {monitorStatus === "pending" && (
        <Text color="gray">Waiting for Claude Code activity...</Text>
      )}

      {monitorStatus === "error" && monitorMessage && (
        <Text color="red">{monitorMessage}</Text>
      )}

      {quizRunning && !currentQuestion && (
        <Text color="gray">Preparing {defaultQuizTitle} quiz...</Text>
      )}

      {quizRunning && currentQuestion && (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text>{currentQuestion.prompt}</Text>
            {currentQuestion.type === "multiple-choice" &&
              currentQuestion.options.map(option => (
                <Text key={option.label}>{`${option.label}) ${option.text}`}</Text>
              ))}
            {currentQuestion.type === "true-false" && (
              <Text>Answer with T (True) or F (False).</Text>
            )}
            {currentQuestion.type === "short-answer" && (
              <Text>Short answer:</Text>
            )}
          </Box>

          <Box
            borderStyle="round"
            borderColor={awaitingAdvance ? "cyan" : "white"}
            paddingX={1}
            paddingY={0}
          >
            <Text>
              <Text color="gray">Your answer:</Text> <Text color={liveAnswerColor}>{liveAnswerPreview}</Text>
            </Text>
          </Box>

          <Text color="gray">
            {awaitingAdvance
              ? advanceEnabled
                ? "Press Enter to continue. Type /end to stop, Ctrl+C to exit."
                : "Take a moment to review."
              : "Press Enter to submit. Type /end to stop, Ctrl+C to exit."}
          </Text>
        </Box>
      )}

      {!quizRunning && monitorStatus !== "error" && (
        <Box flexDirection="column" gap={1}>
          {sessionCompletedMessage ? (
            <Text color="green">{sessionCompletedMessage}</Text>
          ) : sessionActive ? (
            <>
              <Text>Quiz paused.</Text>
              <Text color="gray">Type /end to stay here. Trigger a new Claude Code task to restart.</Text>
            </>
          ) : (
            <>
              <Text>Open a Claude Code session to start the quiz.</Text>
              <Text color="gray">Questions pause automatically when the session ends.</Text>
            </>
          )}
        </Box>
      )}

      {feedback && (
        <Box
          borderStyle="round"
          borderColor={feedback.type === "success" ? "green" : feedback.type === "error" ? "red" : "yellow"}
          paddingX={1}
          paddingY={feedback.explanation || feedback.detail ? 1 : 0}
          flexDirection="column"
          gap={0}
        >
          <Text color={feedback.type === "success" ? "green" : feedback.type === "error" ? "red" : "yellow"} bold>
            {feedback.heading}
          </Text>
          <Text>
            <Text color="cyan">Your answer:</Text> <Text color="white">{feedback.userAnswer}</Text>
          </Text>
          {feedback.type === "error" && feedback.correctAnswer && (
            <Text>
              <Text color="cyan">Correct answer:</Text> <Text color="white">{feedback.correctAnswer}</Text>
            </Text>
          )}
          {feedback.type === "success" && feedback.correctAnswer && (
            <Text>
              <Text color="cyan">Matched answer:</Text> <Text color="white">{feedback.correctAnswer}</Text>
            </Text>
          )}
          {feedback.detail && (
            <Text color="yellow">{feedback.detail}</Text>
          )}
          {feedback.explanation && (
            <Text color="gray">Explanation: {feedback.explanation}</Text>
          )}
        </Box>
      )}

    </Box>
  );
};

render(<App />);
