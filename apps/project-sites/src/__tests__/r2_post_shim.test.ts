import { buildR2PostForm } from '../services/r2_post_shim.js';

const config = {
  endpoint: 'https://r2.example.com',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  bucket: 'my-bucket',
  keyPrefix: 'uploads',
};

describe('buildR2PostForm (AP6)', () => {
  it('returns url + all required signed POST fields', async () => {
    const form = await buildR2PostForm(config, 1_800_000_000_000);
    expect(form.url).toContain('my-bucket');
    expect(form.fields.key).toBe('uploads/${filename}');
    expect(form.fields.policy).toBeTruthy();
    expect(form.fields['x-amz-algorithm']).toBe('AWS4-HMAC-SHA256');
    expect(form.fields['x-amz-signature']).toBeTruthy();
    expect(form.fields['x-amz-credential']).toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('honors custom maxContentLength + expiresIn', async () => {
    const form = await buildR2PostForm(
      { ...config, maxContentLength: 1_000_000, expiresIn: 120 },
      1_800_000_000_000,
    );
    const policy = JSON.parse(atob(form.fields.policy));
    const range = policy.conditions.find(
      (c: unknown) => Array.isArray(c) && c[0] === 'content-length-range',
    );
    expect(range[2]).toBe(1_000_000);
  });

  it('drops the key prefix when none is given', async () => {
    const form = await buildR2PostForm({ ...config, keyPrefix: '' }, 1_800_000_000_000);
    expect(form.fields.key).toBe('${filename}');
  });

  it('caps expiration at 2 days', async () => {
    const form = await buildR2PostForm(
      { ...config, expiresIn: 7 * 24 * 60 * 60 },
      1_800_000_000_000,
    );
    const policy = JSON.parse(atob(form.fields.policy));
    const exp = new Date(policy.expiration).getTime();
    const max = 1_800_000_000_000 + 2 * 24 * 60 * 60 * 1000;
    expect(exp).toBeLessThanOrEqual(max + 1000);
  });
});
