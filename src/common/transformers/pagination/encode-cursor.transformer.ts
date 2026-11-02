export function encodeCursorTransformer(params?: {
  uuid: string;
  timestamp: number;
}): string | undefined {
  if (!params?.uuid || !params?.timestamp) {
    return undefined;
  }

  const { uuid, timestamp } = params;
  return Buffer.from(`${uuid}_${timestamp}`, 'utf-8').toString('base64');
}
