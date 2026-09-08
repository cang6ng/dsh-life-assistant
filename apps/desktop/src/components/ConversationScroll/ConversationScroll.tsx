/**
 * ConversationScroll (§15/§27.1): the conversation's auto-follow scroll
 * container. Frozen rules:
 *   - following while the user is ≤ 80 px from the scroll end;
 *   - new content scrolls to bottom: instant while streaming, 200 ms smooth
 *     only for structural inserts (a new turn block); session switch snaps
 *     instantly after first paint;
 *   - scrolled up past the threshold during an active stream → follow stops;
 *     scrolling back resumes immediately;
 *   - new user message (send) always scrolls to bottom;
 *   - the "back to latest" pill appears when follow is off AND new content
 *     arrived since (§15.2).
 * Commit timing is left to the rAF-batched dispatcher in app.tsx — this
 * component only reacts to committed content.
 */

import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { makeStyles } from "@fluentui/react-components";
import { ScrollToBottomPill } from "../ScrollToBottomPill/ScrollToBottomPill";

const FOLLOW_THRESHOLD = 80; // px, §15.1

const useStyles = makeStyles({
  root: {
    position: "relative",
    flex: "1 1 auto",
    minHeight: "0",
    display: "flex",
    flexDirection: "column",
  },
  scroller: {
    flex: "1 1 auto",
    minHeight: "0",
    overflowY: "auto",
    overflowX: "hidden",
  },
  content: {
    display: "flex",
    flexDirection: "column",
  },
  pillHost: {
    position: "absolute",
    bottom: "8px",
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
    pointerEvents: "none",
    zIndex: 1,
  },
});

export interface ConversationScrollHandle {
  /** §15.1 send / pill click: jump to the bottom and resume following. */
  jumpToBottom: () => void;
  /** True while the viewport follows the newest content. */
  isFollowing: () => boolean;
}

export interface ConversationScrollProps {
  /** Key the content identity: conversation column keyed by session. */
  sessionKey: string;
  /** Stable content depth used to detect new turn blocks (structural). */
  children: ReactNode;
  /** Structural child count (turn blocks) for smooth-scroll detection. */
  blockCount: number;
}

export const ConversationScroll = forwardRef<ConversationScrollHandle, ConversationScrollProps>(
  function ConversationScroll({ sessionKey, children, blockCount }, ref) {
    const styles = useStyles();
    const scrollerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const followingRef = useRef(true);
    const missedRef = useRef(false);
    const prevSessionRef = useRef(sessionKey);
    const prevBlockCountRef = useRef(blockCount);
    const [pill, setPill] = useState(false);

    useImperativeHandle(ref, () => ({
      jumpToBottom: () => {
        const el = scrollerRef.current;
        if (el === null) return;
        followingRef.current = true;
        missedRef.current = false;
        setPill(false);
        el.scrollTop = el.scrollHeight;
      },
      isFollowing: () => followingRef.current,
    }));

    // Track "at bottom" from real scroll events (user wheel/keys).
    const onScroll = (): void => {
      const el = scrollerRef.current;
      if (el === null) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD;
      if (atBottom) {
        followingRef.current = true;
        missedRef.current = false;
        setPill(false);
      } else {
        followingRef.current = false;
      }
    };

    // After every commit: follow (smooth for structural inserts, instant for
    // streaming) or mark missed content while the user is scrolled up.
    useLayoutEffect(() => {
      const el = scrollerRef.current;
      const content = contentRef.current;
      if (el === null || content === null) return;

      if (prevSessionRef.current !== sessionKey) {
        // §15.1 session switch / restore: snap to the bottom after first paint.
        prevSessionRef.current = sessionKey;
        prevBlockCountRef.current = blockCount;
        followingRef.current = true;
        missedRef.current = false;
        setPill(false);
        el.scrollTop = el.scrollHeight;
        return;
      }

      const structural = blockCount !== prevBlockCountRef.current;
      prevBlockCountRef.current = blockCount;
      if (followingRef.current) {
        if (structural) {
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        } else {
          el.scrollTop = el.scrollHeight;
        }
      } else {
        missedRef.current = true;
        setPill(true);
      }
    }, [children, sessionKey, blockCount]);

    return (
      <div className={styles.root}>
        <div
          ref={scrollerRef}
          className={styles.scroller}
          role="log"
          aria-label="会话内容"
          onScroll={onScroll}
        >
          <div ref={contentRef} className={styles.content}>
            {children}
          </div>
        </div>
        {pill && (
          <div className={styles.pillHost}>
            <ScrollToBottomPill
              onClick={() => {
                const el = scrollerRef.current;
                if (el === null) return;
                followingRef.current = true;
                missedRef.current = false;
                setPill(false);
                el.scrollTop = el.scrollHeight;
              }}
            />
          </div>
        )}
      </div>
    );
  },
);
