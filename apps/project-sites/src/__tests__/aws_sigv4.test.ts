/**
 * AWS SigV4 signer — verified against AWS's published "get-vanilla" known-answer
 * test vector (docs.aws.amazon.com SigV4 test suite). If the signer reproduces
 * the canonical signature for the canonical inputs, the algorithm is correct.
 */
import { signRequestV4 } from '../platform/aws-sigv4.js';

describe('signRequestV4 — AWS get-vanilla known-answer vector', () => {
  it('reproduces the canonical Authorization signature', async () => {
    const headers = await signRequestV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      region: 'us-east-1',
      service: 'service',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      amzDate: '20150830T123600Z',
      dateStamp: '20150830',
      // no body → signed headers stay host;x-amz-date (matches the vector)
    });

    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('includes x-amz-content-sha256 + security-token in signed headers when present', async () => {
    const headers = await signRequestV4({
      method: 'POST',
      url: 'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails',
      region: 'us-east-1',
      service: 'ses',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secret',
      sessionToken: 'tok',
      body: '{"x":1}',
      headers: { 'content-type': 'application/json' },
      amzDate: '20260620T000000Z',
      dateStamp: '20260620',
    });
    expect(headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['x-amz-security-token']).toBe('tok');
    expect(headers.Authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token',
    );
    expect(headers.Authorization).toContain(
      'Credential=AKIDEXAMPLE/20260620/us-east-1/ses/aws4_request',
    );
  });
});
