/** Visual Automation Builder (#28, ROI 2.25) — pure journey schema engine. Zero I/O. */
export type TriggerType = 'form_submitted' | 'page_visited' | 'purchase_made' | 'booking_confirmed' | 'tag_added' | 'date_reached';
export type ActionType = 'send_email' | 'send_sms' | 'add_tag' | 'remove_tag' | 'update_crm' | 'notify_owner' | 'webhook';
export interface JourneyStep { id: string; type: ActionType; config: Record<string,string>; delayMinutes: number; }
export interface Journey { id: string; name: string; trigger: TriggerType; triggerConfig: Record<string,string>; steps: JourneyStep[]; enabled: boolean; }

export function validateJourney(j: Journey): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!j.name) errors.push('Journey name is required');
  if (!j.trigger) errors.push('Trigger is required');
  if (j.steps.length === 0) errors.push('At least one step is required');
  for (const s of j.steps) {
    if (s.delayMinutes < 0) errors.push(`Step ${s.id}: delay cannot be negative`);
    if (s.type === 'send_email' && !s.config.to) errors.push(`Step ${s.id}: email requires "to"`);
  }
  return { valid: errors.length === 0, errors };
}
export function estimateDuration(j: Journey): number {
  return j.steps.reduce((sum, s) => sum + s.delayMinutes, 0);
}
export const TRIGGER_LABELS: Record<TriggerType,string> = { form_submitted:'Form Submitted', page_visited:'Page Visited', purchase_made:'Purchase Made', booking_confirmed:'Booking Confirmed', tag_added:'Tag Added', date_reached:'Date Reached' };
export const ACTION_LABELS: Record<ActionType,string> = { send_email:'Send Email', send_sms:'Send SMS', add_tag:'Add Tag', remove_tag:'Remove Tag', update_crm:'Update CRM', notify_owner:'Notify Owner', webhook:'Call Webhook' };
