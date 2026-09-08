/**
 * Fluent glyph map for the §10.1 tool icons (UI Spec §29 glyph list).
 * `toolMeta.ts` stores icon NAMES; this module binds them to components so
 * toolMeta stays importable by pure unit tests (no React).
 */

import {
  AlbumRegular,
  BookmarkRegular,
  CodeRegular,
  DocumentRegular,
  HistoryRegular,
  MusicNote2Regular,
  ReceiptRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import type { FluentIcon } from "@fluentui/react-icons";
import type { ToolMeta } from "./toolMeta";

const GLYPHS: Record<ToolMeta["icon"], FluentIcon> = {
  Search: SearchRegular,
  Albums: AlbumRegular,
  MusicNote: MusicNote2Regular,
  Receipt: ReceiptRegular,
  Document: DocumentRegular,
  Bookmark: BookmarkRegular,
  History: HistoryRegular,
  Code: CodeRegular,
};

export function toolGlyph(icon: ToolMeta["icon"]): FluentIcon {
  return GLYPHS[icon];
}
