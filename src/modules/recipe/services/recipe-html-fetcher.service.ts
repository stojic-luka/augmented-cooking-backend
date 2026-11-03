import { Injectable } from '@nestjs/common';
import { RecipeImportException } from '../../../common/exceptions/index';
import { UrlGuardService } from './url-guard.service';

const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const BROWSER_HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en',
  'User-Agent':
    'Mozilla/5.0 (compatible; AugmentedCookingBot/1.0; +https://augmentedcooking.app/bot)',
};

/**
 * Fetches recipe pages with SSRF protection on every redirect hop, a hard
 * timeout, and a response-size cap.
 */
@Injectable()
export class RecipeHtmlFetcherService {
  constructor(private readonly urlGuard: UrlGuardService) {}

  async fetchHtml(rawUrl: string, signal: AbortSignal): Promise<string> {
    let currentUrl = await this.urlGuard.assertSafeFetchable(rawUrl);

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await this.fetchOnce(currentUrl, signal);

      if (this.isRedirect(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new RecipeImportException('The server returned an invalid redirect.');
        }
        if (hop === MAX_REDIRECTS) {
          throw new RecipeImportException('Too many redirects while fetching the recipe.');
        }
        currentUrl = await this.urlGuard.assertSafeFetchable(
          new URL(location, currentUrl).toString(),
        );
        continue;
      }

      if (!response.ok) {
        throw new RecipeImportException(`The page could not be fetched (HTTP ${response.status}).`);
      }

      return await this.readBody(response);
    }

    throw new RecipeImportException('Too many redirects while fetching the recipe.');
  }

  private async fetchOnce(url: URL, signal: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const combined = AbortSignal.any([signal, timeout]);

    try {
      return await fetch(url, {
        method: 'GET',
        headers: BROWSER_HEADERS,
        redirect: 'manual',
        signal: combined,
      });
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      throw new RecipeImportException(
        'The page could not be fetched. It may be unreachable or too slow.',
      );
    }
  }

  private isRedirect(status: number): boolean {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
  }

  private async readBody(response: Response): Promise<string> {
    const declaredLength = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
      throw new RecipeImportException('The page is too large to import.');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new RecipeImportException('The page returned an empty response.');
    }

    const chunks: Uint8Array[] = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > MAX_HTML_BYTES) {
        await reader.cancel();
        throw new RecipeImportException('The page is too large to import.');
      }
      chunks.push(value);
    }

    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8').decode(merged);
  }
}
