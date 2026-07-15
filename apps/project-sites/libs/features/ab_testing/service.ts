/**
 * A/B Testing Engine (#6, ROI 2.13) — pure variant assignment + stats engine. Zero I/O.
 */
export interface Variant { id: string; name: string; weight: number; config: Record<string,unknown>; }
export interface Experiment { id: string; name: string; variants: Variant[]; targetMetric: string; minSampleSize: number; }

export function assignVariant(experiment: Experiment, visitorId: string): Variant {
  const hash = [...visitorId].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const bucket = Math.abs(hash) % 100;
  let cumulative = 0;
  for (const v of experiment.variants) {
    cumulative += v.weight;
    if (bucket < cumulative) return v;
  }
  return experiment.variants[0];
}

export function computeSignificance(control: { conversions: number; total: number }, variant: { conversions: number; total: number }): { significant: boolean; confidence: number; winner: string } {
  const cr = control.total > 0 ? control.conversions / control.total : 0;
  const vr = variant.total > 0 ? variant.conversions / variant.total : 0;
  const lift = cr > 0 ? (vr - cr) / cr : 0;
  const pooled = (control.conversions + variant.conversions) / (control.total + variant.total);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / control.total + 1 / variant.total));
  const z = se > 0 ? Math.abs(vr - cr) / se : 0;
  const p = 1 - normalCdf(z);
  return { significant: p < 0.05, confidence: Math.round((1 - p) * 100), winner: lift > 0.02 ? 'variant' : lift < -0.02 ? 'control' : 'tie' };
}

function normalCdf(x: number): number { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); return 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); }
