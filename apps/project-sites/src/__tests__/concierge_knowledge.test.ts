import { knowledgeForVertical, VERTICAL_KNOWLEDGE } from '../services/concierge_knowledge.js';

describe('knowledgeForVertical', () => {
  it('classifies a family-medicine clinic as medical', () => {
    const vk = knowledgeForVertical('family medicine clinic', 'medical', 'Summit Primary Care');
    expect(vk).toBe(VERTICAL_KNOWLEDGE.medical);
    expect(vk?.services).toMatch(/physicals/i);
  });

  it('prefers dental over medical for a dental practice (specificity/order)', () => {
    expect(knowledgeForVertical('dental practice', 'dental', 'Oakmont Dental')).toBe(
      VERTICAL_KNOWLEDGE.dental,
    );
  });

  it('classifies a law firm as legal and surfaces the free-consultation fact', () => {
    const vk = knowledgeForVertical('law firm', 'legal', 'Whitfield Cross Law Group');
    expect(vk).toBe(VERTICAL_KNOWLEDGE.legal);
    expect(vk?.faqs).toMatch(/free/i);
  });

  it('classifies a software product as saas', () => {
    expect(knowledgeForVertical('software', 'saas', 'Northpeak Analytics')).toBe(
      VERTICAL_KNOWLEDGE.saas,
    );
  });

  it('classifies a farm-to-table restaurant as restaurant (not nonprofit)', () => {
    expect(knowledgeForVertical('farm-to-table restaurant', 'restaurant', 'Rivertown Grill')).toBe(
      VERTICAL_KNOWLEDGE.restaurant,
    );
  });

  it('returns null when there is no signal', () => {
    expect(knowledgeForVertical(undefined, undefined, '')).toBeNull();
    expect(knowledgeForVertical()).toBeNull();
  });

  it('every vertical entry has non-empty services + faqs', () => {
    for (const [, vk] of Object.entries(VERTICAL_KNOWLEDGE)) {
      expect(vk.services.length).toBeGreaterThan(20);
      expect(vk.faqs.length).toBeGreaterThan(20);
    }
  });
});
