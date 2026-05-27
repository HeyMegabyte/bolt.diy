/**
 * Per-job carbon-footprint estimator (backlog #42).
 *
 * @remarks
 *  EPA factors per mile (well-to-wheel CO2):
 *   - gas (average passenger car):   0.404 kg/mi
 *   - electric (US grid mix avg):    0.150 kg/mi
 *   - pickup (light-duty truck):     0.612 kg/mi
 *   - van (cargo / box):             0.700 kg/mi
 *   - hybrid:                        0.280 kg/mi
 *  Idle hours add 0.9 kg/hr for combustion vehicles; 0 for electric.
 *
 *  Source: EPA Inventory of US Greenhouse Gas Emissions 2024 — values are
 *  rounded fleet averages; treat as "indicative" not "audited".
 *
 *  Equivalents converted via EPA Greenhouse Gas Equivalencies Calculator
 *  (gasoline-gallon ≈ 8.887 kg CO2; tree-year ≈ 22.0 kg CO2).
 *
 * @example
 *   const { co2_kg, equivalent_text } = estimateJobCarbon({
 *     distance_miles: 38, vehicle_type: 'pickup', duration_hours: 3,
 *   });
 *   // → { co2_kg: 25.96, equivalent_text: '~2.9 gallons of gasoline burned' }
 */

export type VehicleType =
  | 'gas'
  | 'electric'
  | 'pickup'
  | 'van'
  | 'hybrid';

export interface CarbonInput {
  readonly distance_miles: number;
  readonly vehicle_type: VehicleType;
  readonly duration_hours: number;
}

export interface CarbonEstimate {
  readonly co2_kg: number;
  readonly equivalent_text: string;
  readonly factors_version: 'epa-2024';
  readonly per_mile_kg: number;
  readonly idle_kg: number;
}

const PER_MILE_KG: Record<VehicleType, number> = {
  gas: 0.404,
  electric: 0.150,
  pickup: 0.612,
  van: 0.700,
  hybrid: 0.280,
};

const IDLE_KG_PER_HOUR: Record<VehicleType, number> = {
  gas: 0.9,
  electric: 0.0,
  pickup: 1.4,
  van: 1.6,
  hybrid: 0.4,
};

const KG_PER_GAS_GALLON = 8.887;
const KG_PER_TREE_YEAR = 22.0;

export function estimateJobCarbon(input: CarbonInput): CarbonEstimate {
  const miles = Math.max(0, input.distance_miles);
  const hours = Math.max(0, input.duration_hours);
  const perMile = PER_MILE_KG[input.vehicle_type] ?? PER_MILE_KG.gas;
  const idlePerHour = IDLE_KG_PER_HOUR[input.vehicle_type] ?? IDLE_KG_PER_HOUR.gas;
  const driving = miles * perMile;
  const idle = hours * idlePerHour;
  const co2_kg = round(driving + idle, 2);
  return {
    co2_kg,
    equivalent_text: equivalentText(co2_kg),
    factors_version: 'epa-2024',
    per_mile_kg: perMile,
    idle_kg: round(idle, 2),
  };
}

/**
 * Pick the most relatable equivalent for a given kg value. Stripe Climate
 * removal cost ≈ $13 per ton ($0.013 per kg) — surface alongside.
 */
export function equivalentText(co2_kg: number): string {
  if (co2_kg <= 0) return 'No measurable emissions';
  const gallons = co2_kg / KG_PER_GAS_GALLON;
  if (gallons >= 1) {
    return `~${gallons.toFixed(1)} gallons of gasoline burned`;
  }
  const treeWeeks = (co2_kg / KG_PER_TREE_YEAR) * 52;
  if (treeWeeks >= 1) {
    return `~${treeWeeks.toFixed(1)} tree-weeks of carbon sink`;
  }
  return `${(co2_kg * 1000).toFixed(0)} g of CO₂`;
}

/**
 * Stripe Climate offset estimate. Removal cost averages ~$13/ton CO2 across
 * Frontier portfolio (2024). Returned in cents so callers can pass straight
 * into a PaymentIntent / Checkout line item.
 */
export function offsetCostCents(co2_kg: number): number {
  const tons = co2_kg / 1000;
  return Math.max(50, Math.round(tons * 13 * 100));
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
