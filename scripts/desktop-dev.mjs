/**
 * Dev launcher behind root `pnpm desktop`.
 *
 * Windows has no process-group cascade: killing a top-level process leaves
 * every descendant alive. `tauri dev` spans two such chains — its own
 * `beforeDevCommand` (vite), and `cargo run` → chinook-desktop.exe → the Node
 * sidecar. When the CLI dies first (a terminal Ctrl+C race, an IDE Stop
 * button, a process-manager kill) its own cleanup never runs, so the next
 * launch starts a second stack next to the orphans: a stale vite keeps 1420
 * bound, and `strictPort: true` turns that into a hard "port in use" failure
 * instead of picking another port.
 *
 * This wrapper closes both ends of that:
 *
 *   1. before spawning, clear anything the previous run of *this repo* left
 *      behind (host, sidecar, vite, CLI) — matched by repo path, so an
 *      unrelated listener on 1420 is reported rather than killed;
 *   2. on exit (including Ctrl+C), taskkill /T the whole tree it started.
 *
 * It inherits pnpm's PATH (with node_modules/.bin), so the `tauri` binary and
 * the `vite` in beforeDevCommand resolve exactly as they did before.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP_DIR = path.join(ROOT, "apps", "desktop");
const DEV_PORT = 1420;

/**
 * Command-line / image shapes unique to this repo's dev stack. Deliberately
 * narrow: `target\debug\chinook-desktop.exe` cannot match the *installed* app
 * under %LOCALAPPDATA%, so a running release build is never touched.
 */
const DEV_SIGNATURES = [
  /scripts[\\/]desktop-dev\.mjs/i, // this launcher
  /vite[\\/]bin[\\/]vite\.js/i, // renderer dev server
  /@tauri-apps[\\/]cli[\\/]tauri\.js/i, // tauri CLI
  /agent-bridge[\\/]dist[\\/]bridge\.mjs/i, // Node sidecar
  /target[\\/]debug[\\/]chinook-desktop\.exe/i, // Rust host (dev build)
];

function runPowerShell(script) {
  return (spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" }).stdout ?? "").trim();
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Processes whose command line or image path points into this repo. */
function repoProcesses() {
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;",
    `$root = '${ROOT.replace(/'/g, "''").toLowerCase()}';`,
    "Get-CimInstance Win32_Process",
    "| Where-Object { ($_.CommandLine -and $_.CommandLine.ToLower().Contains($root))",
    "-or ($_.ExecutablePath -and $_.ExecutablePath.ToLower().Contains($root)) }",
    "| Select-Object ProcessId, CommandLine, ExecutablePath",
    "| ConvertTo-Json -Compress",
  ].join(" ");
  const raw = runPowerShell(script);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return []; // fall back to the port check below
  }
}

function commandLineOf(pid) {
  return runPowerShell(`(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`);
}

/** PIDs holding `port` in the LISTENING state (TCP, v4 or v6). */
function listenerPids(port) {
  const out = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" }).stdout ?? "";
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
    if (match && Number(match[1]) === port) pids.add(match[2]);
  }
  return [...pids];
}

function waitForPortRelease(port) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && listenerPids(port).length > 0) sleepSync(100);
}

/** taskkill walks the descendant tree, which is exactly the orphan shape. */
function killTree(pid) {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
}

function reclaimFromPreviousRun() {
  const strays = repoProcesses().filter(
    (proc) =>
      proc.ProcessId !== process.pid &&
      DEV_SIGNATURES.some((re) => re.test(proc.CommandLine ?? "") || re.test(proc.ExecutablePath ?? "")),
  );
  if (strays.length > 0) {
    console.log(`[desktop-dev] 清理上次残留的进程:${strays.map((proc) => proc.ProcessId).join(", ")}`);
    for (const proc of strays) killTree(proc.ProcessId);
    waitForPortRelease(DEV_PORT);
  }

  // Anything still bound after the sweep matched no repo path — a genuine
  // conflict we do not own, so report it instead of killing it.
  for (const pid of listenerPids(DEV_PORT)) {
    const cmd = commandLineOf(pid);
    if (cmd.toLowerCase().includes(ROOT.toLowerCase())) {
      console.log(`[desktop-dev] 端口 ${DEV_PORT} 仍被残留进程占用(PID ${pid}),正在清理…`);
      killTree(pid);
      waitForPortRelease(DEV_PORT);
    } else {
      console.error(`[desktop-dev] 端口 ${DEV_PORT} 被其他程序占用(PID ${pid}):${cmd || "命令行未知"}`);
      console.error("[desktop-dev] 请先释放该端口,再运行 pnpm desktop。");
      process.exit(1);
    }
  }
}

reclaimFromPreviousRun();

const child = spawn("tauri", ["dev"], {
  cwd: DESKTOP_DIR,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (child.pid) killTree(child.pid);
}

child.on("exit", (code) => {
  cleanup();
  process.exitCode = code ?? 0;
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

// Last resort for exits we do not control (uncaught error, explicit exit).
process.on("exit", cleanup);
