/**
 * Session title index (contract §17, UI Spec §5.2).
 *
 * DSH session headers carry no title, so the bridge owns a disposable
 * presentation index at `$DSH_HOME/desktop-session-index.json`. It stores
 * ONLY { sessionId → { title, messageCount } } — never session content —
 * and is rebuilt from hydrated logs whenever an entry is missing.
 *
 * Title rule (frozen): first user message text, trimmed, newlines collapsed
 * to spaces, truncated at 24 characters with `…`. A session that never got a
 * user message keeps `title: ""` (the sidebar renders 新会话, UI Spec §5.2).
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeJsonFileAtomically } from "./jsonl.js";

export interface TitleIndexEntry {
  title: string;
  messageCount: number;
}
export interface TitleIndexShape {
  version: 1;
  sessions: Record<string, TitleIndexEntry>;
}

export const TITLE_MAX = 24;
export const INDEX_FILENAME = "desktop-session-index.json";

/** Frozen title derivation: trim → collapse whitespace/newlines → 24 + …. */
export function deriveTitle(rawText: string): string {
  const collapsed = rawText.replace(/\s+/g, " ").trim();
  return collapsed.length > TITLE_MAX ? `${collapsed.slice(0, TITLE_MAX)}…` : collapsed;
}

export function defaultIndexPath(dshHome: string): string {
  return resolve(dshHome, INDEX_FILENAME);
}

export class TitleIndex {
  private readonly file: string;
  private data: TitleIndexShape = { version: 1, sessions: {} };
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(dshHome: string, file?: string) {
    this.file = file ?? defaultIndexPath(dshHome);
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<TitleIndexShape>;
        this.data = {
          version: 1,
          sessions: (parsed.sessions ?? {}) as Record<string, TitleIndexEntry>,
        };
      }
    } catch (error) {
      // disposable index — corrupt/partial file starts empty, never fatal
      process.stderr.write(`[bridge] title index unreadable (${this.file}): ${String(error)}\n`);
      this.data = { version: 1, sessions: {} };
    }
  }

  get(sessionId: string): TitleIndexEntry | undefined {
    return this.data.sessions[sessionId];
  }

  /** Set a field; persist is debounced + flushed on exit. */
  set(sessionId: string, patch: Partial<TitleIndexEntry>): void {
    const existing = this.data.sessions[sessionId] ?? { title: "", messageCount: 0 };
    this.data.sessions[sessionId] = { ...existing, ...patch };
    this.dirty = true;
    this.schedulePersist();
  }

  entries(): Array<{ sessionId: string } & TitleIndexEntry> {
    return Object.entries(this.data.sessions).map(([sessionId, entry]) => ({ sessionId, ...entry }));
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    writeJsonFileAtomically(this.file, this.data);
  }

  private schedulePersist(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 300);
  }
}

export function indexPathFromHome(home: string): string {
  return join(home, INDEX_FILENAME);
}
