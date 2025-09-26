import fs from "fs";
import path from "path";
import { EventEmitter } from "events";

export interface FileMonitorOptions {
  root: string;
  filter?: (filePath: string) => boolean;
}

export interface FileMonitorEvents {
  change: [filePath: string];
  error: [error: Error];
}

export class FileMonitor extends EventEmitter {
  private readonly root: string;

  private readonly filter: FileMonitorOptions["filter"];

  private watcher: fs.FSWatcher | null = null;

  constructor(options: FileMonitorOptions) {
    super();
    this.root = options.root;
    this.filter = options.filter;
  }

  start(): void {
    try {
      this.watcher = fs.watch(
        this.root,
        { recursive: true },
        (eventType, filename) => {
          if (!filename) {
            return;
          }

          const resolved = path.resolve(this.root, filename.toString());
          if (this.filter && !this.filter(resolved)) {
            return;
          }

          this.emit("change", resolved);
        }
      );

      this.watcher.on("error", (error) => {
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit("error", err);
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
