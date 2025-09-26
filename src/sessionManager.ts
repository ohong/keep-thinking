import { EventEmitter } from "events";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, watch } from "node:fs/promises";
import type { FileChangeInfo } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionEventPayload } from "./types.js";

interface MessageContent {
  type?: string;
  text?: string;
}

interface MessageRecord {
  message?: {
    id?: string;
    role?: string;
    type?: string;
    content?: MessageContent[];
  };
  timestamp?: string;
}

type SessionStatus = "ACTIVE" | "INACTIVE";

interface SessionRecord {
  status: SessionStatus;
  filePath: string;
  projectPath: string;
  lastMessage: MessageRecord | null;
}

type FsWatcher = AsyncIterableIterator<FileChangeInfo<string>> & { close(): void };

const ACTIVITY_WINDOW_MS = 5 * 60 * 1000;

export interface SessionManagerOptions {
  claudePaths?: string[];
  activityWindowMs?: number;
}

export class SessionManager extends EventEmitter {
  private readonly activityWindowMs: number;

  private readonly claudePaths: string[];

  private readonly sessions = new Map<string, SessionRecord>();

  private watchers: FsWatcher[] = [];

  private isShuttingDown = false;

  private active = false;

  private activeSessionId: string | null = null;

  private sessionStartedAt: Date | null = null;

  constructor(options: SessionManagerOptions = {}) {
    super();
    this.activityWindowMs = options.activityWindowMs ?? ACTIVITY_WINDOW_MS;
    this.claudePaths = options.claudePaths ?? this.resolveClaudePaths();
  }

  async start(): Promise<void> {
    if (this.claudePaths.length === 0) {
      this.emit(
        "error",
        new Error(
          "No Claude data directories found. Launch Claude Code at least once before running Keep Thinking."
        )
      );
      return;
    }

    await this.initialScan();

    await Promise.all(
      this.claudePaths.map(async (basePath) => {
        const projectsDir = path.join(basePath, "projects");
        await this.watchDirectory(projectsDir);
      })
    );
  }

  stop(): void {
    this.isShuttingDown = true;
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch (error) {
        this.emitError(error);
      }
    }
    this.watchers = [];
    this.sessions.clear();
    this.active = false;
    this.activeSessionId = null;
    this.sessionStartedAt = null;
  }

  isActive(): boolean {
    return this.active;
  }

  getActiveFile(): string | null {
    if (!this.activeSessionId) {
      return null;
    }
    return this.sessions.get(this.activeSessionId)?.filePath ?? null;
  }

  getSessionStartTime(): Date | null {
    return this.sessionStartedAt;
  }

  private resolveClaudePaths(): string[] {
    const paths: string[] = [];
    const envPaths = (process.env.CLAUDE_CONFIG_DIR || "").trim();

    if (envPaths) {
      const entries = envPaths
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      for (const entry of entries) {
        if (existsSync(path.join(entry, "projects"))) {
          paths.push(entry);
        }
      }
    }

    const defaultPaths = [
      path.join(os.homedir(), ".config", "claude"),
      path.join(os.homedir(), ".claude"),
    ];

    for (const candidate of defaultPaths) {
      if (existsSync(path.join(candidate, "projects"))) {
        paths.push(candidate);
      }
    }

    return paths;
  }

  private async initialScan(): Promise<void> {
    const sessions = this.findAllSessions();

    for (const session of sessions) {
      await this.updateSessionState(session.sessionId, session.filePath, session.projectPath);
    }

    this.evaluateActiveState();
  }

  private findAllSessions(): Array<{
    sessionId: string;
    projectPath: string;
    filePath: string;
  }> {
    const results: Array<{ sessionId: string; projectPath: string; filePath: string }> = [];

    for (const claudePath of this.claudePaths) {
      const projectsDir = path.join(claudePath, "projects");
      if (!existsSync(projectsDir)) {
        continue;
      }

      let projectDirs: string[];
      try {
        projectDirs = readdirSync(projectsDir);
      } catch (error) {
        this.emitError(error);
        continue;
      }

      for (const projectDir of projectDirs) {
        const projectPath = path.join(projectsDir, projectDir);

        let stats;
        try {
          stats = statSync(projectPath);
        } catch (error) {
          this.emitError(error);
          continue;
        }

        if (!stats.isDirectory()) {
          continue;
        }

        let files: string[];
        try {
          files = readdirSync(projectPath);
        } catch (error) {
          this.emitError(error);
          continue;
        }

        for (const file of files) {
          if (!this.isUuidFilename(file)) {
            continue;
          }

          const filePath = path.join(projectPath, file);
          const sessionId = file.replace(/\.jsonl$/i, "");
          results.push({ sessionId, projectPath: projectDir, filePath });
        }
      }
    }

    return results;
  }

  private async watchDirectory(dirPath: string): Promise<void> {
    if (!existsSync(dirPath) || this.isShuttingDown) {
      return;
    }

    try {
      const watcher = watch(dirPath, { recursive: true }) as FsWatcher;
      this.watchers.push(watcher);

      (async () => {
        try {
          for await (const event of watcher) {
            if (this.isShuttingDown) {
              break;
            }

            const filename = event.filename ? event.filename.toString() : "";
            if (!filename.endsWith(".jsonl")) {
              continue;
            }

            const fullPath = path.join(dirPath, path.normalize(filename));
            const sessionId = this.getSessionIdFromFile(fullPath);
            if (!sessionId) {
              continue;
            }

            await this.handleFileChange(fullPath);
          }
        } catch (error) {
          this.emitError(error);
        }
      })().catch((error) => this.emitError(error));
    } catch (error) {
      this.emitError(error);
    }
  }

  private async handleFileChange(filePath: string): Promise<void> {
    const sessionId = this.getSessionIdFromFile(filePath);
    if (!sessionId) {
      return;
    }

    if (!existsSync(filePath)) {
      if (this.sessions.delete(sessionId)) {
        this.evaluateActiveState();
      }
      return;
    }

    const projectPath = path.basename(path.dirname(filePath));
    await this.updateSession(sessionId, filePath, projectPath);
    this.evaluateActiveState(sessionId);
  }

  private async updateSessionState(
    sessionId: string,
    filePath: string,
    projectPath: string
  ): Promise<void> {
    const lastMessage = await this.parseLastMessage(filePath);
    const status: SessionStatus = this.isActiveMessage(lastMessage) ? "ACTIVE" : "INACTIVE";

    this.sessions.set(sessionId, {
      status,
      filePath,
      projectPath,
      lastMessage,
    });
  }

  private async updateSession(
    sessionId: string,
    filePath: string,
    projectPath: string
  ): Promise<void> {
    const lastMessage = await this.parseLastMessage(filePath);
    const status: SessionStatus = this.isActiveMessage(lastMessage) ? "ACTIVE" : "INACTIVE";

    this.sessions.set(sessionId, {
      status,
      filePath,
      projectPath,
      lastMessage,
    });
  }

  private evaluateActiveState(preferredSessionId?: string): void {
    const activeEntries = Array.from(this.sessions.entries()).filter(
      ([, record]) => record.status === "ACTIVE"
    );

    if (activeEntries.length === 0) {
      if (this.active) {
        const preferredRecord = preferredSessionId
          ? this.sessions.get(preferredSessionId) ?? null
          : null;
        const activeRecord = this.activeSessionId
          ? this.sessions.get(this.activeSessionId) ?? null
          : null;
        const sessionFile = preferredRecord?.filePath ?? activeRecord?.filePath ?? "";
        this.emit("sessionEnd", { sessionFile, timestamp: new Date() });
        this.active = false;
        this.activeSessionId = null;
        this.sessionStartedAt = null;
      }
      return;
    }

    let chosenEntry: [string, SessionRecord] | null = null;

    if (preferredSessionId) {
      const preferredRecord = this.sessions.get(preferredSessionId);
      if (preferredRecord && preferredRecord.status === "ACTIVE") {
        chosenEntry = [preferredSessionId, preferredRecord];
      }
    }

    if (!chosenEntry) {
      chosenEntry = activeEntries[0];
    }

    const [sessionId, record] = chosenEntry;

    if (!this.active) {
      this.active = true;
      this.activeSessionId = sessionId;
      this.sessionStartedAt = new Date();
      this.emit("sessionStart", {
        sessionFile: record.filePath,
        timestamp: this.sessionStartedAt,
      });
      return;
    }

    if (this.activeSessionId !== sessionId) {
      this.activeSessionId = sessionId;
      this.sessionStartedAt = new Date();
      this.emit("sessionStart", {
        sessionFile: record.filePath,
        timestamp: this.sessionStartedAt,
      });
    }
  }

  private async parseLastMessage(filePath: string): Promise<MessageRecord | null> {
    try {
      const content = await readFile(filePath, "utf8");
      const lines = content
        .trim()
        .split("\n")
        .filter((line) => line.trim().length > 0);

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const parsed = JSON.parse(lines[index]) as MessageRecord;
          return parsed;
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      this.emitError(error);
    }

    return null;
  }

  private isActiveMessage(message: MessageRecord | null): boolean {
    if (!message?.message) {
      return false;
    }

    const timestamp = message.timestamp ? new Date(message.timestamp).getTime() : NaN;
    if (Number.isNaN(timestamp)) {
      return false;
    }

    if (Date.now() - timestamp > this.activityWindowMs) {
      return false;
    }

    const role = message.message.role;
    const type = message.message.type;

    if (role === "assistant" && type === "message") {
      const hasToolUse = message.message.content?.some((item) => item.type === "tool_use");
      if (hasToolUse) {
        return true;
      }

      const textContent = message.message.content?.find((item) => item.type === "text");
      if (textContent?.text) {
        const text = textContent.text.trim();
        return (
          text.startsWith("Now I'll") ||
          text.startsWith("I'll") ||
          text.startsWith("Now I") ||
          text.startsWith("Now let") ||
          text.startsWith("Finally,") ||
          text.includes("Let me") ||
          text.includes("I need")
        );
      }

      return false;
    }

    return true;
  }

  private isUuidFilename(filename: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i.test(filename);
  }

  private getSessionIdFromFile(filePath: string): string | null {
    const filename = path.basename(filePath);
    if (!this.isUuidFilename(filename)) {
      return null;
    }
    return filename.replace(/\.jsonl$/i, "");
  }

  private emitError(error: unknown): void {
    if (!error) {
      return;
    }

    const err = error instanceof Error ? error : new Error(String(error));
    this.emit("error", err);
  }
}
