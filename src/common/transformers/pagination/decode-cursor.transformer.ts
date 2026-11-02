import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DecodedCursor } from './types';

export function decodeCursorTransformer({ value }: { value: string }): DecodedCursor | undefined {
  if (!value) return undefined;

  try {
    const [uuid, timestamp] = Buffer.from(value, 'base64').toString('ascii').split('_');

    // Buffer.from silently drops invalid base64 characters, so a tampered
    // cursor can decode to an empty/garbage payload — validate strictly.
    if (!isUUID(uuid, '4')) {
      throw new BadRequestException('Invalid cursor: First component must be a valid UUIDv4');
    }
    if (!Number.isFinite(+timestamp) || +timestamp <= 0) {
      throw new BadRequestException('Invalid cursor: Second component must be a positive number');
    }

    return { uuid, timestamp: +timestamp };
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException('Invalid pagination cursor format');
  }
}
