#!/usr/bin/env node

import React from "react";
import { render } from "ink";
import { loadQuestions } from "./questionLoader.js";
import { QuestionEngine } from "./questionEngine.js";
import { SessionManager } from "./sessionManager.js";
import { App } from "./ui/App.js";

async function main() {
  let sessionManager: SessionManager | null = null;

  try {
    const questions = await loadQuestions();
    const questionEngine = new QuestionEngine(questions);
    sessionManager = new SessionManager();
    await sessionManager.start();

    const stdin = typeof process.stdin === "object" ? process.stdin : undefined;

    const rawModeSupported = Boolean(
      stdin?.isTTY && typeof stdin?.setRawMode === "function"
    );

    const renderOptions: Parameters<typeof render>[1] = {
      exitOnCtrlC: false,
    };

    if (rawModeSupported && stdin) {
      renderOptions.stdin = stdin;
    }

    const { waitUntilExit } = render(
      <App
        sessionManager={sessionManager}
        questionEngine={questionEngine}
        inputEnabled={rawModeSupported}
      />,
      renderOptions
    );

    await waitUntilExit();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown initialization error";
    console.error("Failed to start Keep Thinking CLI:", message);
    process.exitCode = 1;
  } finally {
    sessionManager?.stop();
  }
}

void main();
