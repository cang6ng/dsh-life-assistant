/**
 * Allowlisted markdown renderer (UI Spec §6.4) — block styles come from
 * Fluent tokens only. Raw HTML never reaches the tree: every construct is
 * parsed to the AST in markdown.ts and rendered here node-by-node.
 */

import { makeStyles, tokens } from "@fluentui/react-components";
import type { ReactElement } from "react";
import { memo } from "react";
import { parseMarkdown, type BlockNode, type InlineNode } from "./markdown";

const useStyles = makeStyles({
  root: {
    fontSize: tokens.fontSizeBase300, // 14px body
    lineHeight: tokens.lineHeightBase400, // 24px
    color: tokens.colorNeutralForeground1,
    wordBreak: "break-word",
    // 8px between blocks (§6.4 paragraphs); not around the container.
    "& > * + *": {
      marginTop: "8px",
    },
  },
  heading1: {
    fontSize: tokens.fontSizeBase500, // 16px
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    marginTop: "12px",
  },
  heading2: {
    fontSize: tokens.fontSizeBase400, // 14px
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    marginTop: "8px",
  },
  heading3: {
    fontSize: "13px",
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    marginTop: "4px",
  },
  strong: {
    fontWeight: tokens.fontWeightSemibold,
  },
  em: {
    fontStyle: "italic",
  },
  codeInline: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "13px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusSmall,
    padding: "0 4px",
  },
  list: {
    margin: 0,
    paddingLeft: "16px", // nested indentation 16px (§6.4)
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  listItem: {
    display: "flex",
    flexDirection: "column",
  },
  pre: {
    margin: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12.5px",
    lineHeight: tokens.lineHeightBase300,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    padding: "8px 10px",
    overflowX: "auto",
    whiteSpace: "pre",
  },
  tableScroll: {
    overflowX: "auto",
  },
  table: {
    borderCollapse: "collapse",
    fontSize: "13.5px",
    width: "100%",
  },
  th: {
    fontWeight: tokens.fontWeightSemibold,
    textAlign: "left",
    border: `1px solid ${tokens.colorNeutralStrokeSubtle}`,
    padding: "6px 10px",
  },
  td: {
    border: `1px solid ${tokens.colorNeutralStrokeSubtle}`,
    padding: "6px 10px",
  },
  quote: {
    margin: 0,
    paddingLeft: "10px",
    borderLeft: `2px solid ${tokens.colorBrandBackground}`,
    color: tokens.colorNeutralForeground2,
  },
  caret: {
    display: "inline-block",
    width: "2px",
    height: "1em",
    verticalAlign: "text-bottom",
    backgroundColor: tokens.colorBrandBackground,
    animationName: "chinookCaretBlink",
    animationDuration: "1.1s",
    animationIterationCount: "infinite",
  },
});

// The caret blink keyframes cannot be declared inside makeStyles (griffel);
// inject them once, globally, and reference by name in the style rule.
const CARET_KEYFRAMES = "@keyframes chinookCaretBlink { 0%,60% { opacity: 1 } 61%,100% { opacity: 0 } }";
let keyframesInjected = false;
function ensureCaretKeyframes(): void {
  if (keyframesInjected) return;
  keyframesInjected = true;
  const style = document.createElement("style");
  style.textContent = CARET_KEYFRAMES;
  document.head.appendChild(style);
}

interface MarkdownViewProps {
  text: string;
  /** Live streaming — a blinking brand caret trails the last block. */
  streaming?: boolean;
}

export const MarkdownView = memo(function MarkdownView({ text, streaming }: MarkdownViewProps) {
  if (streaming) ensureCaretKeyframes();
  const blocks = parseMarkdown(text);
  const styles = useStyles();
  return (
    <div className={styles.root}>
      {blocks.map((block, i) => (
        <Block key={i} node={block} styles={styles} last={i === blocks.length - 1} streaming={streaming} />
      ))}
    </div>
  );
});

interface Styles {
  heading1: string;
  heading2: string;
  heading3: string;
  strong: string;
  em: string;
  codeInline: string;
  list: string;
  listItem: string;
  pre: string;
  tableScroll: string;
  table: string;
  th: string;
  td: string;
  quote: string;
  caret: string;
}

function Block({
  node,
  styles,
  last,
  streaming,
}: {
  node: BlockNode;
  styles: Styles;
  last: boolean;
  streaming?: boolean;
}): ReactElement {
  switch (node.t) {
    case "p":
      return (
        <p>
          <Inline nodes={node.children} styles={styles} />
          {streaming && last && <span className={styles.caret} aria-hidden="true" />}
        </p>
      );
    case "h": {
      const cls = node.level === 1 ? styles.heading1 : node.level === 2 ? styles.heading2 : styles.heading3;
      const Tag = (node.level === 1 ? "h3" : node.level === 2 ? "h4" : "h5") as "h3" | "h4" | "h5";
      return (
        <Tag className={cls}>
          <Inline nodes={node.children} styles={styles} />
        </Tag>
      );
    }
    case "list": {
      const ListTag = node.ordered ? "ol" : "ul";
      return (
        <ListTag className={styles.list}>
          {node.children.map((li, i) => (
            <li key={i} className={styles.listItem}>
              {li.blocks.map((b, j) => {
                if (b.t === "p") {
                  return (
                    <div key={j}>
                      <Inline nodes={b.children} styles={styles} />
                    </div>
                  );
                }
                return <Block key={j} node={b} styles={styles} last={false} />;
              })}
            </li>
          ))}
        </ListTag>
      );
    }
    case "code":
      return (
        <pre className={styles.pre}>
          <code>{node.text}</code>
        </pre>
      );
    case "table":
      return (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {node.header.map((cells, i) => (
                  <th key={i} className={styles.th}>
                    <Inline nodes={cells} styles={styles} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cells, c) => (
                    <td key={c} className={styles.td}>
                      <Inline nodes={cells} styles={styles} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "quote":
      return (
        <blockquote className={styles.quote}>
          <Inline nodes={node.children} styles={styles} />
        </blockquote>
      );
  }
}

function Inline({ nodes, styles }: { nodes: InlineNode[]; styles: Styles }): ReactElement {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.t) {
          case "text":
            return <span key={i}>{node.text}</span>;
          case "bold":
            return (
              <strong key={i} className={styles.strong}>
                <Inline nodes={node.children} styles={styles} />
              </strong>
            );
          case "italic":
            return (
              <em key={i} className={styles.em}>
                <Inline nodes={node.children} styles={styles} />
              </em>
            );
          case "code":
            return (
              <code key={i} className={styles.codeInline}>
                {node.text}
              </code>
            );
        }
      })}
    </>
  );
}
