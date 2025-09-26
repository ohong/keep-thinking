import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { QuestionEngine } from "../questionEngine.js";
import { SessionManager } from "../sessionManager.js";
import { Question, ScoreSnapshot } from "../types.js";

interface AppProps {
  sessionManager: SessionManager;
  questionEngine: QuestionEngine;
  inputEnabled: boolean;
}

interface FeedbackMessage {
  text: string;
  tone: "success" | "error";
}

const CLAUDE_MESSAGES = [
  "Claude isn't Clauding right now. Put him to work to continue your learning journey!",
  "No Claude, no questions! Boot up Claude Code to keep your brain active.",
  "Claude is currently in sleep mode. Execute Claude Code to resume your micro-learning!",
  "Looks like Claude wandered off again. Fire up Claude Code to unlock today's knowledge!",
  "Claude has gone silent! Summon him back with Claude Code to continue learning!",
  "Idle Claude detected. Maintain active Claude Code session to keep thinking!",
  "Learning requires active Claude energy. Keep Claude Code clauding to feed your brain!",
  "Claude has gone into hibernation mode. Only a working Claude Code can wake your learning session!",
  "Claude's gone offline! Keep Claude Code busy to continue your education!",
  "Warning: Claude is slacking off. Put Claude Code to work to resume your quiz!",
  "Claude stopped thinking! Get Claude Code processing to unlock more questions!",
  "No active Claude detected. Keep Claude Code working to expand your knowledge!",
  "Claude went AFK! Get Claude Code clauding to continue your learning streak!",
  "Your brain is waiting for Claude! Get Claude Code processing to learn something new!",
  "Keep Thinking craves Claude energy! Get Claude Code clauding to level up!",
  "No Claude brain activity! Get Claude Code thinking to resume your education!",
  "Claude is ghosting us! Start Claude Code working to continue your quiz!",
  "No Claude in sight! Keep Claude Code active to unlock today's wisdom!",
  "No Claude juice detected! Keep Claude Code active to power your learning!",
  "Claude has powered down! Start Claude Code thinking to feed your curiosity!",
];

function getRandomClaudeMessage(): string {
  return CLAUDE_MESSAGES[Math.floor(Math.random() * CLAUDE_MESSAGES.length)];
}

export const App: React.FC<AppProps> = ({
  sessionManager,
  questionEngine,
  inputEnabled,
}) => {
  const { exit } = useApp();

  useEffect(() => {
    const handleSigint = () => {
      exit();
    };

    process.on("SIGINT", handleSigint);

    return () => {
      process.off("SIGINT", handleSigint);
    };
  }, [exit]);

  const [isActive, setIsActive] = useState(sessionManager.isActive());
  const [question, setQuestion] = useState<Question | null>(
    questionEngine.getCurrentQuestion()
  );
  const [score, setScore] = useState<ScoreSnapshot>(questionEngine.getScore());
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const [answerBuffer, setAnswerBuffer] = useState("");
  const [timerMs, setTimerMs] = useState(0);
  const [sessionStart, setSessionStart] = useState<Date | null>(
    sessionManager.getSessionStartTime()
  );
  const [activeFile, setActiveFile] = useState<string | null>(
    sessionManager.getActiveFile()
  );
  const [sessionCompletedMessage, setSessionCompletedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [idleMessage, setIdleMessage] = useState<string>(() => getRandomClaudeMessage());

  useEffect(() => {
    const handleStart = (payload: { sessionFile: string; timestamp: Date }) => {
      setErrorMessage(null);
      questionEngine.start();
      setIsActive(true);
      setQuestion(questionEngine.getCurrentQuestion());
      setScore(questionEngine.getScore());
      setFeedback(null);
      setAnswerBuffer("");
      setSessionStart(payload.timestamp);
      setActiveFile(payload.sessionFile);
      setSessionCompletedMessage(null);
      setIdleMessage(getRandomClaudeMessage());
    };

    const handleEnd = (payload: { sessionFile: string; timestamp: Date }) => {
      questionEngine.stop();
      setIsActive(false);
      setQuestion(null);
      setSessionStart(null);
      setActiveFile(payload.sessionFile);
      setSessionCompletedMessage("Claude Code task complete - return to your session");
      setIdleMessage(getRandomClaudeMessage());
    };

    const handleError = (error: Error) => {
      setErrorMessage(error.message);
    };

    sessionManager.on("sessionStart", handleStart);
    sessionManager.on("sessionEnd", handleEnd);
    sessionManager.on("error", handleError);

    return () => {
      sessionManager.off("sessionStart", handleStart);
      sessionManager.off("sessionEnd", handleEnd);
      sessionManager.off("error", handleError);
    };
  }, [questionEngine, sessionManager]);

  useEffect(() => {
    if (!isActive || !sessionStart) {
      setTimerMs(0);
      return;
    }

    let cancelled = false;

    const update = () => {
      if (cancelled || !sessionStart) {
        return;
      }
      setTimerMs(Date.now() - sessionStart.getTime());
    };

    update();
    const interval = setInterval(update, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isActive, sessionStart]);

  const formattedTimer = useMemo(() => formatDuration(timerMs), [timerMs]);

  const statusText = isActive
    ? "Time to be usefully distracted"
    : "Get busy coding";

  const onSubmit = useCallback(
    (input: string) => {
      try {
        const outcome = questionEngine.submitAnswer(input);
        const message: FeedbackMessage = outcome.correct
          ? { text: "✓ Correct!", tone: "success" }
          : {
              text: `✗ Incorrect. The answer is ${outcome.question.correctAnswer} because ${outcome.question.explanation}`,
              tone: "error",
            };

        setFeedback(message);
        setScore(questionEngine.getScore());
        setQuestion(questionEngine.getCurrentQuestion());
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setErrorMessage(err.message);
      }
    },
    [questionEngine]
  );

  const clearAnswer = useCallback(() => setAnswerBuffer(""), []);

  const handleExit = useCallback(() => exit(), [exit]);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round">
      <KeepThinkingLogo />
      <StatusBar text={statusText} isActive={isActive} />

      <Box marginTop={1} flexDirection="row" justifyContent="space-between">
        <Text>
          Score: {score.correct}/{score.total}
        </Text>
        <Text>Session timer: {formattedTimer}</Text>
      </Box>

      {activeFile && (
        <Box marginTop={1}>
          <Text dimColor>{`Watching: ${activeFile}`}</Text>
        </Box>
      )}

      {errorMessage && (
        <Box marginTop={1}>
          <Text color="red">{errorMessage}</Text>
        </Box>
      )}

      {sessionCompletedMessage && !isActive && (
        <Box marginTop={1}>
          <Text color="green">{sessionCompletedMessage}</Text>
        </Box>
      )}

      {!inputEnabled && (
        <Box marginTop={1}>
          <Text color="yellow">
            Input is disabled because this terminal does not support raw mode.
            Run Keep Thinking in an interactive terminal to answer questions.
          </Text>
        </Box>
      )}

      {inputEnabled && (
        <InputController
          isActive={isActive}
          answerBuffer={answerBuffer}
          setAnswerBuffer={setAnswerBuffer}
          onSubmit={onSubmit}
          clearAnswer={clearAnswer}
          exit={handleExit}
        />
      )}

      {isActive ? (
        <ActiveSessionView
          question={question}
          answerBuffer={answerBuffer}
          feedback={feedback}
        />
      ) : (
        <IdleSessionView message={idleMessage} />
      )}
    </Box>
  );
};

const IdleSessionView: React.FC<{ message: string }> = ({ message }) => (
  <Box marginTop={2} flexDirection="column">
    <Text>Waiting for Claude Code to start a session...</Text>
    <Text dimColor>
      Keep this terminal visible. Learning mode will begin automatically when a
      session changes to active.
    </Text>
    <Box marginTop={1}>
      <ClaudeMessage message={message} />
    </Box>
  </Box>
);

interface ActiveSessionViewProps {
  question: Question | null;
  answerBuffer: string;
  feedback: FeedbackMessage | null;
}

const ActiveSessionView: React.FC<ActiveSessionViewProps> = ({
  question,
  answerBuffer,
  feedback,
}) => {
  if (!question) {
    return (
      <Box marginTop={2}>
        <Text>Loading next question…</Text>
      </Box>
    );
  }

  return (
    <Box marginTop={2} flexDirection="column">
      <Text>
        {question.id}: {question.text}
      </Text>
      {question.options && (
        <Box marginTop={1} flexDirection="column">
          {question.options.map((option) => (
            <Text key={option}>{option}</Text>
          ))}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text>
          Your answer: <Text color="cyan">{answerBuffer || " "}</Text>
        </Text>
        <Text dimColor>Press Enter to submit. Esc clears your input.</Text>
      </Box>

      {feedback && (
        <Box marginTop={1}>
          <Text color={feedback.tone === "success" ? "green" : "red"}>
            {feedback.text}
          </Text>
        </Box>
      )}
    </Box>
  );
};

interface StatusBarProps {
  text: string;
  isActive: boolean;
}

const StatusBar: React.FC<StatusBarProps> = ({ text, isActive }) => (
  <Box
    paddingX={1}
    paddingY={0}
    borderStyle="single"
    borderColor={isActive ? "green" : "yellow"}
  >
    <Text color={isActive ? "green" : "yellow"}>{text}</Text>
  </Box>
);

const ClaudeMessage: React.FC<{ message: string }> = ({ message }) => (
  <Text color="cyan" dimColor>
    {message}
  </Text>
);

/**
 * Keep Thinking Logo Component
 */

const KeepThinkingLogo: React.FC<{ bannerText?: string }> = ({ bannerText }) => (
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

interface InputControllerProps {
  isActive: boolean;
  answerBuffer: string;
  setAnswerBuffer: React.Dispatch<React.SetStateAction<string>>;
  onSubmit: (input: string) => void;
  clearAnswer: () => void;
  exit: () => void;
}

const InputController: React.FC<InputControllerProps> = ({
  isActive,
  answerBuffer,
  setAnswerBuffer,
  onSubmit,
  clearAnswer,
  exit,
}) => {
  useInput((input, key) => {
    if (!isActive) {
      return;
    }

    if (key.return) {
      if (answerBuffer.trim().length > 0) {
        onSubmit(answerBuffer);
        clearAnswer();
      }
      return;
    }

    if (key.escape) {
      clearAnswer();
      return;
    }

    if (key.backspace || key.delete) {
      setAnswerBuffer((prev) => prev.slice(0, -1));
      return;
    }

    if (input) {
      setAnswerBuffer((prev) => prev + input);
    }
  });

  return null;
};

function formatDuration(durationMs: number): string {
  if (durationMs <= 0) {
    return "00:00";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
