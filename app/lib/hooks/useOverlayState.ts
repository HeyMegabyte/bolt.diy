/**
 * @file Hover overlay state machine for chat + prompt over .z-workbench.
 *
 * States: hidden | peek | visible | focused | busy
 *
 * - **hidden**: mouse nowhere near overlay, prompt not focused → `pointer-events: none`
 * - **peek**: mouse in the hover-intent zone near bottom → faint reveal
 * - **visible**: mouse hovering over overlay area → fully visible
 * - **focused**: prompt textarea or child control has focus → stays visible
 * - **busy**: streaming, pending confirmation, error, or active generation → stays visible
 *
 * @example
 * const { overlayState, overlayProps } = useOverlayState({ isStreaming, hasError });
 * <div data-overlay-state={overlayState} {...overlayProps}>...</div>
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type OverlayState = 'hidden' | 'peek' | 'visible' | 'focused' | 'busy';

interface UseOverlayStateOptions {
  isStreaming?: boolean;
  hasError?: boolean;
  hasPendingConfirmation?: boolean;
  isGenerating?: boolean;

  /** Whether the user prefers reduced motion */
  reducedMotion?: boolean;
}

interface OverlayStateResult {
  overlayState: OverlayState;
  overlayProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  };
}

export function useOverlayState(opts: UseOverlayStateOptions = {}): OverlayStateResult {
  const { isStreaming, hasError, hasPendingConfirmation, isGenerating, reducedMotion } = opts;

  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Busy state overrides everything
  const busy = isStreaming || hasError || hasPendingConfirmation || isGenerating;

  // Derive state
  const overlayState: OverlayState = busy ? 'busy' : focused ? 'focused' : hovering ? 'visible' : 'hidden';

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (hoverTimer.current) {
        clearTimeout(hoverTimer.current);
      }

      if (leaveTimer.current) {
        clearTimeout(leaveTimer.current);
      }
    };
  }, []);

  const onMouseEnter = useCallback(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }

    if (reducedMotion) {
      setHovering(true);
    } else {
      hoverTimer.current = setTimeout(() => setHovering(true), 150);
    }
  }, [reducedMotion]);

  const onMouseLeave = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }

    if (!focused && !busy) {
      if (reducedMotion) {
        setHovering(false);
      } else {
        leaveTimer.current = setTimeout(() => setHovering(false), 600);
      }
    }
  }, [focused, busy, reducedMotion]);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => {
    setFocused(false);

    if (!hovering && !busy) {
      setHovering(false);
    }
  }, [hovering, busy]);

  return {
    overlayState,
    overlayProps: { onMouseEnter, onMouseLeave, onFocus, onBlur },
  };
}
