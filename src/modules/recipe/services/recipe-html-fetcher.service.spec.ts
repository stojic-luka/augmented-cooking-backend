import type { Mock } from 'vitest';
import { RecipeImportException } from '../../../common/exceptions/index';
import { RecipeHtmlFetcherService } from './recipe-html-fetcher.service';
import { UrlGuardService } from './url-guard.service';

const MAX_HTML_BYTES = 2 * 1024 * 1024;

function htmlResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(body, {
    status: 200,
    ...init,
    headers: { 'content-type': 'text/html', ...init.headers },
  });
}

function redirectResponse(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

describe('RecipeHtmlFetcherService', () => {
  let urlGuard: { assertSafeFetchable: Mock };
  let fetchMock: Mock;
  let service: RecipeHtmlFetcherService;
  const signal = new AbortController().signal;
  const originalFetch = global.fetch;

  beforeEach(() => {
    urlGuard = {
      assertSafeFetchable: vi.fn(async (raw: string) => new URL(raw)),
    };
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new RecipeHtmlFetcherService(urlGuard as unknown as UrlGuardService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the decoded HTML of a successful response', async () => {
    fetchMock.mockResolvedValue(htmlResponse('<html>recipe</html>'));

    const html = await service.fetchHtml('https://example.blog/recipe', signal);

    expect(html).toBe('<html>recipe</html>');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'https://example.blog/recipe' }),
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('re-validates every redirect hop before following it', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse('https://cdn.example.blog/recipe-2'))
      .mockResolvedValueOnce(htmlResponse('<html>moved</html>'));

    const html = await service.fetchHtml('https://example.blog/recipe', signal);

    expect(html).toBe('<html>moved</html>');
    expect(urlGuard.assertSafeFetchable).toHaveBeenCalledTimes(2);
    expect(urlGuard.assertSafeFetchable).toHaveBeenNthCalledWith(1, 'https://example.blog/recipe');
    expect(urlGuard.assertSafeFetchable).toHaveBeenNthCalledWith(
      2,
      'https://cdn.example.blog/recipe-2',
    );
  });

  it('resolves relative redirect targets against the current hop', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse('/recipe-final'))
      .mockResolvedValueOnce(htmlResponse('ok'));

    await service.fetchHtml('https://example.blog/recipe', signal);

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ href: 'https://example.blog/recipe-final' }),
      expect.anything(),
    );
  });

  it('rejects a redirect without a location header', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302 }));

    await expect(service.fetchHtml('https://example.blog/recipe', signal)).rejects.toThrow(
      new RecipeImportException('The server returned an invalid redirect.'),
    );
  });

  it('gives up after more than three redirects', async () => {
    fetchMock.mockImplementation(async () => redirectResponse('https://example.blog/loop'));

    await expect(service.fetchHtml('https://example.blog/recipe', signal)).rejects.toThrow(
      new RecipeImportException('Too many redirects while fetching the recipe.'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 followed hops
  });

  it('maps non-2xx responses to a RecipeImportException with the status', async () => {
    fetchMock.mockResolvedValue(new Response('gone', { status: 404 }));

    await expect(service.fetchHtml('https://example.blog/recipe', signal)).rejects.toThrow(
      new RecipeImportException('The page could not be fetched (HTTP 404).'),
    );
  });

  it('rejects pages whose declared content-length exceeds the size cap', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse('x', { headers: { 'content-length': String(MAX_HTML_BYTES + 1) } }),
    );

    await expect(service.fetchHtml('https://example.blog/recipe', signal)).rejects.toThrow(
      new RecipeImportException('The page is too large to import.'),
    );
  });

  it('aborts reading when the streamed body exceeds the size cap even with a small declared length', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_HTML_BYTES + 1).fill(65));
        controller.close();
      },
    });
    Object.defineProperty(stream, 'cancel', { value: cancel });
    fetchMock.mockResolvedValue(new Response(stream, { headers: { 'content-length': '10' } }));

    await expect(service.fetchHtml('https://example.blog/recipe', signal)).rejects.toThrow(
      new RecipeImportException('The page is too large to import.'),
    );
  });

  it('maps transport failures to a RecipeImportException', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(service.fetchHtml('https://example.blog/recipe', signal)).rejects.toThrow(
      new RecipeImportException(
        'The page could not be fetched. It may be unreachable or too slow.',
      ),
    );
  });

  it('rethrows the original error when the caller already aborted', async () => {
    const controller = new AbortController();
    const abortError = new Error('The operation was aborted');
    controller.abort();
    fetchMock.mockRejectedValue(abortError);

    await expect(service.fetchHtml('https://example.blog/recipe', controller.signal)).rejects.toBe(
      abortError,
    );
  });
});
