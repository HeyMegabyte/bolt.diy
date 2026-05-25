import React, { useEffect, useState } from 'react';
import type { Message } from 'ai';
import { fetchPromptSuggestions, type PromptSuggestion } from '~/lib/chat/suggestions';

interface PromptSuggestionsProps {
  messages: Message[];
  isStreaming: boolean;
  onPick: (prompt: string) => void;
}

/**
 * Renders 3 ghost chips above the chat input. Refreshes whenever a new
 * assistant message lands and streaming stops.
 */
export const PromptSuggestions: React.FC<PromptSuggestionsProps> = ({ messages, isStreaming, onPick }) => {
  const [items, setItems] = useState<PromptSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isStreaming || messages.length === 0) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchPromptSuggestions(messages)
      .then((s) => {
        if (!cancelled) {
          setItems(s);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [messages.length, isStreaming]);

  if (loading && items.length === 0) {
    return null;
  }

  if (!items.length) {
    return null;
  }

  return (
    <div data-testid="prompt-suggestions" className="flex flex-wrap gap-1.5 mb-1 px-1">
      {items.map((s) => (
        <button
          key={s.prompt}
          type="button"
          onClick={() => onPick(s.prompt)}
          title={s.prompt}
          className="text-xs px-2.5 py-1 rounded-full bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:border-bolt-elements-item-contentAccent transition-colors"
        >
          <span className="i-ph:sparkle text-xs mr-1" />
          {s.label}
        </button>
      ))}
    </div>
  );
};
