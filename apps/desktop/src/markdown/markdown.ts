/**
 * Allowlisted markdown subset parser (UI Spec §6.4) — pure TS, no React, no
 * deps. Supported: paragraphs, `#`–`###` headings, bold/italic/inline code,
 * bullet & numbered lists (nested), fenced code blocks (no highlighting),
 * tables (header + delimiter row), blockquotes. Anything else is ignored and
 * never rendered raw (no raw HTML, images, autolinks, footnotes).
 *
 * Streaming tolerance: a trailing unterminated code fence or table is
 * demoted back to paragraphs (no flash of raw syntax, no giant empty code
 * block), and unterminated inline markers are dropped.
 */

export type InlineNode =
  | { t: "text"; text: string }
  | { t: "bold"; children: InlineNode[] }
  | { t: "italic"; children: InlineNode[] }
  | { t: "code"; text: string };

export type BlockNode =
  | { t: "p"; children: InlineNode[] }
  | { t: "h"; level: 1 | 2 | 3; children: InlineNode[] }
  | { t: "list"; ordered: boolean; depth: number; children: ListItemNode[] }
  | { t: "code"; lang: string; text: string }
  | { t: "table"; header: InlineNode[][]; rows: InlineNode[][][] }
  | { t: "quote"; children: InlineNode[] };

interface ListItemNode {
  blocks: BlockNode[];
}

// ---------------------------------------------------------------------------
// inline
// ---------------------------------------------------------------------------

/** Parse inline content; unterminated markers degrade to plain text. */
export function parseInline(src: string): InlineNode[] {
  const out: InlineNode[] = [];
  let i = 0;
  const text = src;

  const pushText = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last && last.t === "text") (last as { text: string }).text += s;
    else out.push({ t: "text", text: s });
  };

  const parseTo = (end: string, inner: (nodes: InlineNode[]) => InlineNode): void => {
    // Find the closing marker; on none, render the rest as plain text.
    const close = text.indexOf(end, i + end.length);
    if (close < 0) {
      pushText(text.slice(i));
      i = text.length;
      return;
    }
    const body = text.slice(i + end.length, close);
    i = close + end.length;
    const children = parseInline(body);
    if (children.length === 0) children.push({ t: "text", text: "" });
    out.push(inner(children));
  };

  while (i < text.length) {
    if (text.startsWith("**", i)) {
      parseTo("**", (c) => ({ t: "bold", children: c }));
    } else if (text[i] === "*") {
      parseTo("*", (c) => ({ t: "italic", children: c }));
    } else if (text[i] === "`") {
      const close = text.indexOf("`", i + 1);
      if (close < 0) {
        pushText(text.slice(i + 1)); // drop the dangling opener
        i = text.length;
      } else {
        pushText("");
        out.push({ t: "code", text: text.slice(i + 1, close) });
        i = close + 1;
      }
    } else {
      pushText(text[i]);
      i += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// blocks
// ---------------------------------------------------------------------------

const FENCE = /^\s*```\s*(\S*)\s*$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_DELIM = /^\s*\|?[\s:\-|]+\|?\s*$/;

/** Split a table row on unescaped pipes; tolerate a missing lead/trail pipe. */
function splitCells(line: string): string[] {
  const raw = line.split("|");
  if (raw[0].trim() === "") raw.shift();
  if (raw.length > 0 && raw[raw.length - 1].trim() === "") raw.pop();
  return raw.map((c) => c.trim());
}

function isDelimiterRow(line: string): boolean {
  return TABLE_DELIM.test(line) && /-/.test(line) && !LIST_ITEM.test(line) && !HEADING.test(line);
}

interface StackItem {
  ordered: boolean;
  depth: number;
  items: ListItemNode[];
}

export function parseMarkdown(src: string): BlockNode[] {
  const lines = src.split("\n");
  const blocks: BlockNode[] = [];
  let i = 0;

  const push = (b: BlockNode) => {
    // Merge adjacent plain paragraphs? No — each block stays separate; the
    // renderer spaces blocks 8px apart (§6.4).
    blocks.push(b);
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = FENCE.exec(line);
    if (fence) {
      const lang = fence[1];
      const body: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (FENCE.test(lines[i])) {
          closed = true;
          i += 1;
          break;
        }
        body.push(lines[i]);
        i += 1;
      }
      if (closed) {
        push({ t: "code", lang, text: body.join("\n") });
      } else {
        // Streaming tolerance: the fence never closed — re-parse the body as
        // ordinary text so a trailing ``` never blanks the answer.
        const demoted: BlockNode[] = parseMarkdown(body.join("\n"));
        for (const b of demoted) push(b);
      }
      continue;
    }

    // heading
    const heading = HEADING.exec(line);
    if (heading) {
      push({ t: "h", level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2]) });
      i += 1;
      continue;
    }

    // blockquote (may span several `>` lines)
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        const m = QUOTE.exec(lines[i])!;
        body.push(m[1]);
        i += 1;
      }
      push({ t: "quote", children: parseInline(body.join("\n")) });
      continue;
    }

    // tables: header row + delimiter row
    if (line.includes("|") && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      const header = splitCells(line).map(parseInline);
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && lines[i].includes("|") && !isDelimiterRow(lines[i])) {
        rows.push(splitCells(lines[i]).map(parseInline));
        i += 1;
      }
      if (rows.length === 0) {
        // A header alone (e.g. mid-stream before rows arrive) is still worth
        // rendering as a table; an empty table would flash nothing useful.
        push({ t: "table", header, rows });
      } else {
        push({ t: "table", header, rows });
      }
      continue;
    }

    // lists (indentation-aware; stack keeps nesting ≤ rendering depth)
    const item = LIST_ITEM.exec(line);
    if (item) {
      const baseIndent = item[1].length;
      const stack: StackItem[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (!m) {
          // Continuation line inside the list: ignore (compact lists).
          if (lines[i].trim() === "") {
            i += 1; // blank line: still allow the next list marker to continue
            continue;
          }
          break;
        }
        const depth = Math.floor(m[1].length / 2);
        const ordered = /^\d/.test(m[2]);
        // A shallower list marker than the current group starts a new list.
        if (depth < baseIndent) break;
        const li: ListItemNode = { blocks: [] };
        // Stack discipline: pop groups deeper than the new item.
        while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
        if (stack.length === 0) {
          const group: StackItem = { ordered, depth, items: [li] };
          stack.push(group);
          blocks.push({ t: "list", ordered, depth, children: group.items });
        } else {
          const parentGroup = stack[stack.length - 1];
          // Attach to the nearest previous item at any depth via the stack:
          // push a fresh group nested under the last item's blocks.
          const parent = parentGroup.items[parentGroup.items.length - 1];
          const group: StackItem = { ordered, depth, items: [li] };
          stack.push(group);
          parent.blocks.push({ t: "list", ordered, depth, children: group.items });
        }
        li.blocks.push({ t: "p", children: parseInline(m[3]) });
        i += 1;
        // Continuation lines (indented or plain) append to this item's text.
        while (i < lines.length) {
          const c = lines[i];
          if (c.trim() === "" || LIST_ITEM.test(c)) break;
          const m2 = HEADING.exec(c) ?? FENCE.exec(c);
          if (m2 || QUOTE.test(c)) break;
          li.blocks.push({ t: "p", children: parseInline(c.trim()) });
          i += 1;
        }
      }
      continue;
    }

    // paragraph
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const body: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !HEADING.test(lines[i]) &&
      !FENCE.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isDelimiterRow(lines[i + 1]))
    ) {
      body.push(lines[i]);
      i += 1;
    }
    push({ t: "p", children: parseInline(body.join(" ")) });
  }

  return blocks;
}
