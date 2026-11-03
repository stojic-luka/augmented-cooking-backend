import { Transform } from 'class-transformer';
import { decodeCursorTransformer } from '../../transformers/pagination/decode-cursor.transformer';

export function DecodeCursor() {
  return Transform(decodeCursorTransformer);
}
