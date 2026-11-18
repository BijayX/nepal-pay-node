import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/esewa.json' with { type: 'json' };
import { signEsewa, verifyEsewaSignature } from '../../src/gateways/esewa/esewa.signature.js';
import { decodeEsewaCallback } from '../../src/gateways/esewa/esewa.callback.js';
import { InvalidCallbackError } from '../../src/index.js';

describe('eSewa signatures (vectors verified against the live UAT endpoint)', () => {
  it.each(fixture.signatureVectors)('signs "$message"', ({ message, signature }) => {
    expect(signEsewa(fixture.secretKey, message)).toBe(signature);
  });

  it('accepts a genuine callback', () => {
    expect(verifyEsewaSignature(fixture.secretKey, fixture.callback.decoded)).toBe(true);
  });

  it('rejects a callback whose amount was edited', () => {
    expect(
      verifyEsewaSignature(fixture.secretKey, { ...fixture.callback.decoded, total_amount: '1.0' }),
    ).toBe(false);
  });

  it('rejects a callback signed with another key', () => {
    expect(verifyEsewaSignature('another-key', fixture.callback.decoded)).toBe(false);
  });

  it('rejects payloads that sign nothing, sign the signature, or omit a signed field', () => {
    const base = fixture.callback.decoded;
    expect(verifyEsewaSignature(fixture.secretKey, { ...base, signed_field_names: '' })).toBe(
      false,
    );
    expect(
      verifyEsewaSignature(fixture.secretKey, { ...base, signed_field_names: 'signature' }),
    ).toBe(false);
    expect(
      verifyEsewaSignature(fixture.secretKey, {
        ...base,
        signed_field_names: 'total_amount,missing',
      }),
    ).toBe(false);
    expect(verifyEsewaSignature(fixture.secretKey, { ...base, signature: undefined })).toBe(false);
  });
});

describe('decodeEsewaCallback', () => {
  it('decodes the base64 data parameter', () => {
    expect(decodeEsewaCallback(fixture.callback.data)).toMatchObject(fixture.callback.decoded);
  });

  it('survives "+" turned into spaces and stripped padding', () => {
    const damaged = fixture.callback.data.replace(/\+/g, ' ').replace(/=+$/, '');
    expect(decodeEsewaCallback(damaged).signature).toBe(fixture.callback.decoded.signature);
  });

  it.each([
    ['not base64 JSON', '%%%'],
    ['a JSON array', Buffer.from('[1]').toString('base64')],
    ['missing fields', Buffer.from('{"status":"COMPLETE"}').toString('base64')],
  ])('rejects %s', (_label, data) => {
    expect(() => decodeEsewaCallback(data)).toThrow(InvalidCallbackError);
  });
});
