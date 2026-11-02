import { encodeCursorTransformer } from './encode-cursor.transformer';

describe('encodeCursorTransformer', () => {
  it('produces a base64 payload decodable back to `uuid_timestamp`', () => {
    const cursor = encodeCursorTransformer({
      uuid: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      timestamp: 1735689600000,
    });

    expect(cursor).toBeDefined();
    expect(Buffer.from(cursor as string, 'base64').toString('utf-8')).toBe(
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301_1735689600000',
    );
  });

  it('returns undefined when the uuid is missing, empty or the timestamp is 0', () => {
    expect(encodeCursorTransformer()).toBeUndefined();
    expect(encodeCursorTransformer({ uuid: '', timestamp: 1 })).toBeUndefined();
    expect(
      encodeCursorTransformer({
        uuid: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        timestamp: 0,
      }),
    ).toBeUndefined();
  });
});
