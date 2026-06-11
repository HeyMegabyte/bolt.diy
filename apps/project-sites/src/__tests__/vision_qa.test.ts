import { rubricToFindings, type VisionScore } from '../routes/vision_qa';

const base: VisionScore = {
  layout: 8,
  typography: 8,
  color: 8,
  imagery: 8,
  whitespace: 8,
  distinctiveness: 8,
  overall: 8,
  notes: '',
  model: 'x',
};

describe('rubricToFindings', () => {
  it('returns no findings when every axis is 7+', () => {
    expect(rubricToFindings(base)).toEqual([]);
  });

  it('flags only axes scoring below 7, with a suggestion', () => {
    const r = rubricToFindings({ ...base, color: 4, whitespace: 6 });
    expect(r.map((f) => f.axis)).toEqual(['color', 'whitespace']); // worst-first
    expect(r[0].value).toBe(4);
    expect(r[0].suggestion.length).toBeGreaterThan(0);
  });

  it('orders findings worst-first', () => {
    const r = rubricToFindings({ ...base, layout: 5, color: 2, typography: 6 });
    expect(r.map((f) => f.value)).toEqual([2, 5, 6]);
  });

  it('ignores null axes (no real score)', () => {
    const r = rubricToFindings({ ...base, layout: null, color: null });
    expect(r).toEqual([]);
  });
});
