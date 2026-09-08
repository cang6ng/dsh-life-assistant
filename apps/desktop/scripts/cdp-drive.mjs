/**
 * Phase-D live-driver (dev tooling, not shipped): talks CDP to the WebView2
 * instance of the running desktop app (launched with
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9223").
 *
 * Usage:
 *   node scripts/cdp-drive.mjs probe                 — text snapshot + errors
 *   node scripts/cdp-drive.mjs click <css>          — click first match
 *   node scripts/cdp-drive.mjs set <css> <text>     — set input value
 *   node scripts/cdp-drive.mjs wait <ms>
 *   node scripts/cdp-drive.mjs watch <ms>           — stay attached, stream console
 *   node scripts/cdp-drive.mjs text <css>
 * Commands run against the same persistent page connection (single CDP
 * session per process). Text is printed as JSON for reliable CJK output.
 */

const PORT = process.env.CDP_PORT ?? "9223";

let ws = null;
let seq = 0;
const pending = new Map();
const consoleErrors = [];

async function connect() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const pages = await res.json();
  const page = pages.find((p) => p.type === "page" && !p.url.startsWith("devtools"));
  if (page === undefined) throw new Error(`no page target: ${JSON.stringify(pages.map((p) => p.type))}`);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error !== undefined) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      consoleErrors.push(`EXC: ${d.text} ${d.exception?.description ?? ""}`.slice(0, 500));
    } else if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
      const args = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      consoleErrors.push(`CONSOLE.${msg.params.type}: ${args}`.slice(0, 500));
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      seq += 1;
      pending.set(seq, { resolve, reject });
      ws.send(JSON.stringify({ id: seq, method, params }));
    });
  await send("Runtime.enable");
  await send("Log.enable");
  return { send };
}

async function evalJs(client, expression) {
  const r = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails !== undefined) {
    throw new Error(`page exception: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`);
  }
  return r.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [cmd, arg1, arg2] = process.argv.slice(2);
  const client = await connect();
  const snapshotExpr = `(() => {
    const pick = (el) => el ? { text: (el.innerText ?? "").slice(0, 4000), visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) } : null;
    const log = document.querySelector('[role="log"]');
    const textareas = [...document.querySelectorAll("textarea")].map(t => ({ placeholder: t.placeholder, disabled: t.disabled, len: t.value.length }));
    const buttons = [...document.querySelectorAll("button")].map(b => (b.innerText ?? "").trim()).filter(Boolean).slice(0, 25);
    const bodyText = (document.body.innerText ?? "").slice(0, 6000);
    return { bodyText, buttons, textareas, log: log ? (log.innerText ?? "").slice(0, 3000) : null };
  })()`;
  switch (cmd) {
    case "probe": {
      const snap = await evalJs(client, snapshotExpr);
      console.log(JSON.stringify({ snap, errors: consoleErrors }, null, 1));
      break;
    }
    case "text": {
      const v = await evalJs(client, `(() => { const el = document.querySelector(${JSON.stringify(arg1)}); return el ? el.innerText ?? el.textContent ?? null : null; })()`);
      console.log(JSON.stringify(v));
      break;
    }
    case "click": {
      const ok = await evalJs(client, `(() => { const el = document.querySelector(${JSON.stringify(arg1)}); if (!el) return false; el.click(); return true; })()`);
      console.log(`clicked:${ok}`);
      break;
    }
    case "click-text": {
      const ok = await evalJs(
        client,
        `(() => {
          const want = ${JSON.stringify(arg1)};
          const els = [...document.querySelectorAll("button, [role='button'], [role='option'], [role='tab']")];
          const el = els.find((b) => (b.innerText ?? "").trim().includes(want)) ?? null;
          if (!el) return false;
          el.click();
          return true;
        })()`,
      );
      console.log(`clicked:${ok}`);
      break;
    }
    case "set": {
      const ok = await evalJs(
        client,
        `(() => {
          const el = document.querySelector(${JSON.stringify(arg1)});
          if (!el) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
          setter.call(el, ${JSON.stringify(arg2)});
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()`,
      );
      console.log(`set:${ok}`);
      break;
    }
    case "wait": {
      await sleep(Number(arg1));
      console.log("waited");
      break;
    }
    case "send": {
      // Compose the active textarea and press Enter (React-compatible).
      const ok = await evalJs(
        client,
        `(() => {
          const el = document.querySelector("textarea");
          if (!el) return "no-textarea";
          el.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
          setter.call(el, ${JSON.stringify(arg1 ?? "")});
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
          return "sent:" + el.value.length;
        })()`,
      );
      console.log(ok);
      break;
    }
    case "watch": {
      const deadline = Date.now() + Number(arg1);
      while (Date.now() < deadline) {
        await sleep(500);
        if (consoleErrors.length > 0) break;
      }
      console.log(JSON.stringify({ errors: consoleErrors }));
      break;
    }
    default:
      console.error(`unknown command ${cmd}`);
      process.exit(2);
  }
  ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
