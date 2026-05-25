import { AnimatePresence, cubicBezier, motion } from 'framer-motion';

interface SendButtonProps {
  show: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
  onImagesSelected?: (images: File[]) => void;
  /**
   * Item 40 — token budget ring. When supplied, the streaming state shows
   * a determinate ring (`tokensUsed/maxTokens`). When omitted, falls back
   * to a smooth indeterminate spin in brand colors.
   */
  tokensUsed?: number;
  maxTokens?: number;
}

const customEasingFn = cubicBezier(0.4, 0, 0.2, 1);

/**
 * Circular progress ring rendered atop the send button while streaming.
 * Uses SVG stroke-dashoffset so animations are off-thread compositor work.
 */
function StreamingRing({ tokensUsed, maxTokens }: { tokensUsed?: number; maxTokens?: number }) {
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const ratio = tokensUsed && maxTokens ? Math.min(tokensUsed / maxTokens, 1) : null;

  return (
    <svg className="ps-send-ring" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r={radius} className="ps-send-ring__track" />
      <circle
        cx="16"
        cy="16"
        r={radius}
        className={ratio === null ? 'ps-send-ring__bar is-indeterminate' : 'ps-send-ring__bar'}
        strokeDasharray={circumference}
        strokeDashoffset={ratio === null ? circumference * 0.7 : circumference * (1 - ratio)}
        transform="rotate(-90 16 16)"
      />
    </svg>
  );
}

export const SendButton = ({ show, isStreaming, disabled, onClick, tokensUsed, maxTokens }: SendButtonProps) => {
  return (
    <AnimatePresence>
      {show ? (
        <motion.button
          className="absolute flex justify-center items-center top-[18px] right-[22px] p-1 bg-accent-500 hover:brightness-94 color-white rounded-md w-[34px] h-[34px] transition-theme disabled:opacity-50 disabled:cursor-not-allowed ps-send-btn"
          data-state={isStreaming ? 'streaming' : 'idle'}
          transition={{ ease: customEasingFn, duration: 0.17 }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          disabled={disabled}
          aria-label={isStreaming ? 'Stop generating' : 'Send message'}
          title={
            isStreaming && tokensUsed && maxTokens
              ? `${tokensUsed.toLocaleString()} / ${maxTokens.toLocaleString()} tokens`
              : undefined
          }
          onClick={(event) => {
            event.preventDefault();

            if (!disabled) {
              onClick?.(event);
            }
          }}
        >
          {isStreaming && <StreamingRing tokensUsed={tokensUsed} maxTokens={maxTokens} />}
          <div className="text-lg relative">
            {!isStreaming ? <div className="i-ph:arrow-right"></div> : <div className="i-ph:stop-circle-bold"></div>}
          </div>
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
};
