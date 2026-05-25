import React, { useMemo } from 'react';
import { estimateCost } from '~/lib/cost-tracking';

interface CostEstimateBadgeProps {
  input: string;
  model?: string;
}

/**
 * Renders an estimated-cost chip above the send button.
 * Hidden when input is empty.
 */
export const CostEstimateBadge: React.FC<CostEstimateBadgeProps> = ({ input, model }) => {
  const estimate = useMemo(() => estimateCost(input ?? '', model), [input, model]);

  if (!estimate.tokens) {
    return null;
  }

  return (
    <div
      data-testid="cost-estimate-badge"
      title={`Estimated input cost for ${estimate.model}`}
      className="text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary flex items-center gap-1 px-2 py-0.5 rounded-md bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor"
    >
      <span className="i-ph:coin text-xs" />
      <span>{estimate.formatted}</span>
    </div>
  );
};
