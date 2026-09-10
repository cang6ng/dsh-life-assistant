/**
 * Allowlisted markdown renderer (UI Spec §6.4) — block styles come from
 * Fluent tokens only. Raw HTML never reaches the tree: every construct is
 * parsed to the AST in markdown.ts and rendered here node-by-node.
 *
 * v1.0.4: the prose is Fluent typography. The `Text` presets carry `as`, so
 * the element the markdown means is still the element that renders — a
 * paragraph stays a `<p>`, and a heading stays a heading at the level §6.4
 * renders (`#` → `<h3>`, `##` → `<h4>`, `###` → `<h5>`) — while the face comes
 * from the design system instead of from hand-set pixels.
 *
 * §20.1/§6.4 are frozen and the ramp does not match them everywhere, so the
 * pixels §20.1 names are pinned in `makeStyles` and handed over through
 * `className`: the conversation body is 14/400/**24** (Fluent's own Body1 line
 * box is 20), the third heading level is **13** px (the ramp has no 13), and
 * code is 12.5/**18** (no preset is 12.5). Everything the frozen clauses do
 * not name is left to the component.
 *
 * What stays hand-rolled, and why:
 *
 * - the table — Fluent's `Table` is an interactive DataGrid: it pins
 *   `table-layout: fixed`, gives every row a `colorNeutralStroke2` bottom
 *   border and every body cell a 44 px floor, and wraps each header cell's
 *   content in an extra `fui-TableHeaderCell__button` div (flex, 32 px floor).
 *   §6.4's table is a static grid with none of that behaviour to gain, so the
 *   component would be a dozen overrides back to the same markup;
 * - the list, the `<blockquote>` rule, the `<pre>` block and the inline-code
 *   chip — v9 has no list, quote or code component at all;
 * - bold and italic — these are properties of a run, not a text preset.
 *   `Body1Strong` would also pin an italic or bold run to 14 px, which is
 *   wrong the moment that run sits inside a heading.
 */

import {
  Body1,
  Body1Strong,
  Subtitle2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { ReactElement } from "react";
import { memo } from "react";
import { CARET_BLINK } from "../motion";
import { parseMarkdown, type BlockNode, type InlineNode } from "./markdown";

const useStyles = makeStyles({
  root: {
    fontSize: tokens.fontSizeBase300, // 14px
    lineHeight: "24px", // §20.1 conversation body 14/400/24
    color: tokens.colorNeutralForeground1,
    wordBreak: "break-word",
    // 8px between blocks (§6.4 paragraphs); not around the container.
    "& > * + *": {
      marginTop: "8px",
    },
  },
  // §6.4 headings are 16/600, 14/600, 13/600 with margins 12/8/4. The first
  // two are Fluent's Subtitle2 and Body1Strong exactly, so these classes carry
  // only what the frozen clause adds on top — the margin, and for the third
  // level a size the ramp does not have. Line boxes stay the presets' own;
  // §6.4 freezes size, weight, colour and margin, not leading.
  heading1: {
    color: tokens.colorNeutralForeground1,
    marginTop: "12px",
  },
  heading2: {
    color: tokens.colorNeutralForeground1,
    marginTop: "8px",
  },
  heading3: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
    marginTop: "4px",
  },
  // Body1 would otherwise impose its own 20 px line box on the paragraph; the
  // frozen body line is 24 (§20.1).
  para: {
    lineHeight: "24px",
  },
  // §6.4: 600 weight / italic. Not presets — see the file header.
  strong: {
    fontWeight: tokens.fontWeightSemibold,
  },
  em: {
    fontStyle: "italic",
  },
  // §6.4: code face 13px, NeutralBackground3, radius 3px, padding 0 4px.
  codeInline: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "13px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "3px",
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
  // §6.4: NeutralBackground3 panel, radius 6px, padding 8–10px, Consolas
  // 12.5px, horizontal scroll. §20.1's code line is 12.5/400/18.
  pre: {
    margin: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12.5px",
    lineHeight: "18px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusLarge, // 6px
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
    animationName: CARET_BLINK, // §21, keyframes in motion.ts
    animationDuration: "400ms",
    animationIterationCount: "infinite",
    // §21: "disabled under prefers-reduced-motion (steady caret)". Dropping
    // the animation leaves the span at its own opacity — i.e. simply lit,
    // which is what §21 asks a reduced-motion client to show instead.
    "@media (prefers-reduced-motion: reduce)": {
      animationName: "none",
    },
  },
});

interface MarkdownViewProps {
  text: string;
  /** Live streaming — a blinking brand caret trails the last block. */
  streaming?: boolean;
}

export const MarkdownView = memo(function MarkdownView({ text, streaming }: MarkdownViewProps) {
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
  para: string;
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
        <Body1 as="p" className={styles.para}>
          <Inline nodes={node.children} styles={styles} />
          {streaming && last && <span className={styles.caret} aria-hidden="true" />}
        </Body1>
      );
    case "h":
      // §6.4's three levels. The rendered element is a real heading at its
      // outline depth; only the preset behind it changes.
      if (node.level === 1) {
        return (
          <Subtitle2 as="h3" className={styles.heading1}>
            <Inline nodes={node.children} styles={styles} />
          </Subtitle2>
        );
      }
      if (node.level === 2) {
        return (
          <Body1Strong as="h4" className={styles.heading2}>
            <Inline nodes={node.children} styles={styles} />
          </Body1Strong>
        );
      }
      return (
        <Body1Strong as="h5" className={styles.heading3}>
          <Inline nodes={node.children} styles={styles} />
        </Body1Strong>
      );
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
