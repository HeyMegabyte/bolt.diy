import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn().mockResolvedValue(true),
}));

import { generateAudioSummary, getAudioSummary, FLAG_KEY } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

const mockBucket = {
  put: jest.fn().mockResolvedValue(undefined),
  head: jest.fn().mockResolvedValue({ key: 'audio-summary/site1/test.mp3' }),
};

const mockEnv = {
  AI: { run: jest.fn().mockResolvedValue({ audio: new Uint8Array([1, 2, 3]) }) },
  DB: { prepare: jest.fn() },
  CACHE_KV: { get: jest.fn(), put: jest.fn() },
  SITES_BUCKET: mockBucket,
} as unknown as Env;

describe('page_audio_summary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('page_audio_summary');
  });

  it('generateAudioSummary() stores audio and returns audioKey', async () => {
    const result = await generateAudioSummary(mockEnv, 'site1', '/about', 'Our story.', undefined);
    expect(result.audioKey).toContain('audio-summary/site1');
    expect(result.audioKey).toContain('.mp3');
    expect(mockBucket.put).toHaveBeenCalled();
  });

  it('generateAudioSummary() falls back gracefully when AI throws', async () => {
    (mockEnv.AI as { run: jest.Mock }).run = jest.fn().mockRejectedValue(new Error('no TTS'));
    const result = await generateAudioSummary(mockEnv, 'site1', '/home', 'text', undefined);
    expect(result.audioKey).toBeTruthy();
    expect(mockBucket.put).toHaveBeenCalled();
  });

  it('getAudioSummary() returns audioUrl when R2 object exists', async () => {
    const result = await getAudioSummary(mockEnv, 'site1', '/about');
    expect(result.audioUrl).toContain('audio-summary/site1');
  });

  it('getAudioSummary() returns null when object does not exist', async () => {
    mockBucket.head = jest.fn().mockResolvedValue(null);
    const result = await getAudioSummary(mockEnv, 'site1', '/missing');
    expect(result.audioUrl).toBeNull();
  });
});
