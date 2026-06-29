/**
 * Unit tests for extractive FAQ-from-reviews (#61). Pure — no env/I/O.
 */

import { describe, it, expect } from '@jest/globals';
import { extractReviewFaqs, type ReviewInput } from '../services/faq_from_reviews.js';

const r = (text: string, rating = 5): ReviewInput => ({ text, rating });

describe('faq_from_reviews — extractReviewFaqs', () => {
  it('emits a FAQ for a well-corroborated topic with a real-review answer', () => {
    const reviews = [
      r('The staff were so friendly and welcoming. Great visit.'),
      r('Very friendly team, polite and helpful throughout.'),
      r('Friendly staff, made us feel welcome.'),
    ];
    const faqs = extractReviewFaqs(reviews);
    const staff = faqs.find((f) => f.question.includes('staff'));
    expect(staff).toBeDefined();
    expect(staff!.mentions).toBe(3);
    expect(staff!.answer.toLowerCase()).toContain('friendly');
  });

  it('drops topics below the minMentions floor (quality over quota)', () => {
    const reviews = [r('Friendly staff.'), r('Great quality work and excellent results, top notch.')];
    // staff=1, quality=1 — both below default floor of 3 → empty
    expect(extractReviewFaqs(reviews)).toEqual([]);
  });

  it('honors a custom minMentions', () => {
    const reviews = [
      r('The place was very clean and tidy throughout our whole visit.'),
      r('Spotless and clean — they really keep it immaculate in here.'),
    ];
    expect(extractReviewFaqs(reviews, { minMentions: 2 }).some((f) => f.question.includes('clean'))).toBe(
      true,
    );
  });

  it('ranks by corroboration and caps at maxItems', () => {
    const reviews = [
      r('friendly staff'),
      r('friendly team'),
      r('friendly and polite'),
      r('great value, affordable price'),
      r('fair price, worth it'),
      r('reasonable cost, good value'),
      r('amazing quality, excellent professional work'),
      r('top notch quality, the best'),
      r('excellent quality work'),
    ];
    const faqs = extractReviewFaqs(reviews, { minMentions: 3, maxItems: 2 });
    expect(faqs).toHaveLength(2);
    // sorted by mentions desc
    expect(faqs[0].mentions).toBeGreaterThanOrEqual(faqs[1].mentions);
  });

  it('prefers a higher-rated review for the representative answer', () => {
    const reviews: ReviewInput[] = [
      { text: 'The price was fair and reasonable for what you get here today.', rating: 3 },
      { text: 'Incredible value — affordable and absolutely worth every penny spent.', rating: 5 },
      { text: 'Reasonable cost overall.', rating: 4 },
    ];
    const faqs = extractReviewFaqs(reviews, { minMentions: 3 });
    const value = faqs.find((f) => f.question.includes('value'));
    expect(value!.answer).toContain('Incredible value');
  });

  it('returns empty for no/blank reviews and skips blanks', () => {
    expect(extractReviewFaqs([])).toEqual([]);
    expect(extractReviewFaqs([{ text: '' }, { text: '   ' }])).toEqual([]);
  });

  it('skips a topic that clears mentions but has no clean representative sentence', () => {
    // "clean" mentioned 3× but only as a bare fragment under 20 chars → no answer
    const reviews = [r('clean'), r('clean'), r('clean')];
    expect(extractReviewFaqs(reviews)).toEqual([]);
  });
});
