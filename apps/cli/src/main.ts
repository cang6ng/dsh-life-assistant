/**
 * chinook-agent: V1 thin command-line client (spec §6, §48 DoD).
 *
 * A plain REPL over the DSH runtime:
 *
 *     You >  what is jazz?
 *     Agent > (assistant reply, streamed)
 *
 * Commands:
 *     /new            start a fresh session (previous sessions stay resumable)
 *     /resume <id>    continue a persisted session; bare /resume lists them
 *     /exit           flush the current session and leave
 *
 * Everything model- or business-related lives in the DSH profile
 * (`profiles/chinook`) and the Chinook plugin; this file only owns the
 * terminal loop and the session-lifetime verbs.
 */

import { createInterface } from "node:readline";
import { AgentRuntime, createAgentRuntime } from "./runtime";

async function main(): Promise<void> {
  const runtime = await createAgentRuntime();
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY === true,
  });

  const prompt = () => "You > ";
  let active: { id: string; lines: string[] } | null = null;

  const showHelp = () => {
    console.log("Commands:");
    console.log("  /new          start a fresh conversation (prior sessions stay resumable)");
    console.log("  /resume [id]  continue session <id>; without an id, list persisted sessions");
    console.log("  /exit         save the current session and quit");
  };

  const closeActive = async () => {
    if (active) await runtime.closeSession();
    active = null;
  };

  const startSession = async (resumeId?: string) => {
    const id = await runtime.startSession(resumeId);
    active = { id, lines: [] };
    console.log(resumeId ? `Resumed session: ${id}` : `Started new session: ${id}`);
  };

  const askAndPrint = async (text: string) => {
    if (!active) {
      // A plain prompt with no session starts one (V1 default: chat first,
      // manage sessions explicitly only when needed).
      await startSession();
    }
    process.stdout.write("Agent > ");
    const reply = await runtime.ask(text, (delta) => {
      process.stdout.write(delta);
    });
    process.stdout.write("\n");
    if (active) active.lines.push(reply);
    if (!reply) console.log("(no reply)");
  };

  rl.setPrompt(prompt());
  if (rl.terminal) rl.prompt();

  let closing = false;
  const drainStdout = () =>
    new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await closeActive();
    rl.close();
    await runtime.dispose();
    console.log("Goodbye.");
    // process.exit skips pending writes; flush first so piped transcripts
    // keep their final line.
    await drainStdout();
    process.exit(0);
  };

  const dispatch = async (input: string): Promise<void> => {
    // Piped transcripts mirror the interactive prompt echo.
    if (!rl.terminal) console.log(`You > ${input}`);
    if (input === "/exit") {
      await shutdown();
    } else if (input === "/new") {
      await closeActive();
      await startSession();
    } else if (input === "/help" || input === "/?") {
      showHelp();
    } else if (input === "/resume") {
      const sessions = await runtime.listSessions();
      if (sessions.length === 0) {
        console.log("No persisted sessions yet.");
      } else {
        console.log("Persisted sessions:");
        for (const s of sessions) console.log(`  ${s.id}`);
      }
    } else if (input.startsWith("/resume ")) {
      const id = input.slice("/resume ".length).trim();
      if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
        console.log(`Invalid session id: ${id}`);
      } else {
        await closeActive();
        await startSession(id);
      }
    } else if (input.startsWith("/")) {
      console.log(`Unknown command: ${input}  (try /help)`);
    } else {
      await askAndPrint(input);
    }
  };

  // Piped input arrives in a flood and readline splits it from its own
  // buffer, so pausing the stream does not serialize handlers. Every line
  // (and shutdown) runs on one promise chain: a handler never overlaps the
  // next, and /exit can never dispose a session that is still setting up.
  let queue: Promise<void> = Promise.resolve();
  rl.on("line", (raw) => {
    const input = raw.trim();
    if (input === "" || closing) return;
    queue = queue
      .then(() => dispatch(input))
      .catch((error) => {
        console.error(`\n[error] ${error instanceof Error ? error.message : String(error)}`);
      })
      .then(() => {
        if (!closing && rl.terminal) rl.prompt();
      });
  });

  // Ctrl+C and EOF (Ctrl+D) both leave cleanly; /exit already shut down, so
  // the closing guard keeps disposal single-run. EOF queues behind any lines
  // still being dispatched.
  rl.on("SIGINT", () => {
    void shutdown();
  });
  rl.on("close", () => {
    queue = queue.then(() => shutdown());
  });
}

main().catch((error) => {
  console.error(`[fatal] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
