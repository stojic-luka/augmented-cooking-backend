import { BadRequestException } from '@nestjs/common';
import { decodeCursorTransformer } from './decode-cursor.transformer';

const UUID_V4 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const UUID_V1 = 'c232ab00-9414-11ec-b4b8-7ff2e5c1e0e1';

const encode = (raw: string) => Buffer.from(raw, 'utf-8').toString('base64');

describe('decodeCursorTransformer', () => {
  it('round-trips a cursor produced by encodeCursorTransformer', () => {
    const cursor = encode(`${UUID_V4}_1735689600000`);

    expect(decodeCursorTransformer({ value: cursor })).toEqual({
      uuid: UUID_V4,
      timestamp: 1735689600000,
    });
  });

  it('returns undefined for an absent cursor (first page)', () => {
    expect(decodeCursorTransformer({ value: '' })).toBeUndefined();
    expect(decodeCursorTransformer({ value: undefined as unknown as string })).toBeUndefined();
  });

  it('rejects a cursor whose first component is not a UUIDv4', () => {
    expect(() => decodeCursorTransformer({ value: encode('not-a-uuid_123') })).toThrow(
      new BadRequestException('Invalid cursor: First component must be a valid UUIDv4'),
    );
  });

  it('rejects a cursor of a different UUID version (v1)', () => {
    expect(() => decodeCursorTransformer({ value: encode(`${UUID_V1}_123`) })).toThrow(
      new BadRequestException('Invalid cursor: First component must be a valid UUIDv4'),
    );
  });

  it('rejects arbitrary junk that decodes to a non-UUID payload', () => {
    expect(() => decodeCursorTransformer({ value: encode('garbage without separator') })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a tampered cursor that silently decodes to an empty string', () => {
    // '%' is invalid base64; Buffer.from drops it and decodes to ''.
    expect(() => decodeCursorTransformer({ value: '%' })).toThrow(BadRequestException);
  });

  it('rejects a cursor whose timestamp component is not a finite number', () => {
    expect(() => decodeCursorTransformer({ value: encode(`${UUID_V4}_not-a-number`) })).toThrow(
      BadRequestException,
    );
    expect(() => decodeCursorTransformer({ value: encode(`${UUID_V4}_NaN`) })).toThrow(
      BadRequestException,
    );
  });

  it('coerces the timestamp with numeric coercion', () => {
    const decoded = decodeCursorTransformer({ value: encode(`${UUID_V4}_42`) });
    expect(decoded).toEqual({ uuid: UUID_V4, timestamp: 42 });
  });
});
