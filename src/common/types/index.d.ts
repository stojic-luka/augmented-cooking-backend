export {};

declare global {
  namespace Express {
    interface Request {
      abortSignal: AbortSignal;
    }
  }
}
