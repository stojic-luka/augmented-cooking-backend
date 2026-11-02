import { getErrorMessage } from './get-error-message.util';

describe('getErrorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies the message property of a plain object', () => {
    expect(getErrorMessage({ message: 42 })).toBe('42');
  });

  it('returns the string itself', () => {
    expect(getErrorMessage('plain failure')).toBe('plain failure');
  });

  it('falls back for null, undefined and primitives without a message', () => {
    expect(getErrorMessage(null)).toBe('An error occurred');
    expect(getErrorMessage(undefined)).toBe('An error occurred');
    expect(getErrorMessage(7)).toBe('An error occurred');
  });
});
