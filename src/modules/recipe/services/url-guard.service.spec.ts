import type { Mock } from 'vitest';
import { lookup } from 'node:dns/promises';
import { InvalidRecipeUrlException } from '../../../common/exceptions/index';
import { UrlGuardService } from './url-guard.service';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

const mockLookup = lookup as unknown as Mock;

function addresses(...ips: string[]) {
  return ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

describe('UrlGuardService', () => {
  let service: UrlGuardService;

  beforeEach(() => {
    mockLookup.mockReset();
    service = new UrlGuardService();
  });

  describe('URL syntax requirements', () => {
    it('rejects unparseable URLs', async () => {
      await expect(service.assertSafeFetchable('not a url')).rejects.toThrow(
        new InvalidRecipeUrlException('url is not a valid URL.'),
      );
    });

    it('rejects non-https schemes', async () => {
      await expect(service.assertSafeFetchable('http://example.com/recipe')).rejects.toThrow(
        new InvalidRecipeUrlException('Only https:// URLs can be imported.'),
      );
      await expect(service.assertSafeFetchable('ftp://example.com/recipe')).rejects.toThrow(
        new InvalidRecipeUrlException('Only https:// URLs can be imported.'),
      );
    });

    it('rejects URLs carrying credentials', async () => {
      mockLookup.mockResolvedValue(addresses('93.184.216.34'));

      await expect(
        service.assertSafeFetchable('https://user:pass@example.com/recipe'),
      ).rejects.toThrow(new InvalidRecipeUrlException('URLs with credentials are not allowed.'));
    });
  });

  describe('IP literal rules (no DNS involved)', () => {
    it.each([
      'https://127.0.0.1/recipe',
      'https://10.1.2.3/recipe',
      'https://172.16.0.9/recipe',
      'https://192.168.1.5/recipe',
      'https://169.254.10.10/recipe',
      'https://100.64.0.1/recipe',
      'https://0.0.0.0/recipe',
      'https://224.0.0.1/recipe',
      'https://[::1]/recipe',
      'https://[::]/recipe',
      'https://[fd00::1]/recipe',
      'https://[fe80::1]/recipe',
      'https://[ff02::1]/recipe',
      'https://[::ffff:127.0.0.1]/recipe',
    ])('rejects the private/reserved address %s', async (url) => {
      await expect(service.assertSafeFetchable(url)).rejects.toThrow(
        new InvalidRecipeUrlException('This URL points to a non-public address.'),
      );
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('accepts a public IP literal and returns the parsed URL', async () => {
      const url = await service.assertSafeFetchable('https://93.184.216.34/recipe');

      expect(mockLookup).not.toHaveBeenCalled();
      expect(url.hostname).toBe('93.184.216.34');
    });
  });

  describe('hostname resolution', () => {
    it('accepts a hostname that resolves to public addresses only', async () => {
      mockLookup.mockResolvedValue(
        addresses('93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'),
      );

      const url = await service.assertSafeFetchable('https://example.com/recipe');

      expect(mockLookup).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });
      expect(url.hostname).toBe('example.com');
    });

    it('rejects when any resolved address is private (DNS rebinding defence)', async () => {
      mockLookup.mockResolvedValue(addresses('93.184.216.34', '192.168.0.10'));

      await expect(service.assertSafeFetchable('https://example.com/recipe')).rejects.toThrow(
        new InvalidRecipeUrlException('This URL points to a non-public address.'),
      );
    });

    it('rejects a hostname resolving to an IPv4-mapped loopback', async () => {
      mockLookup.mockResolvedValue(addresses('::ffff:127.0.0.1'));

      await expect(service.assertSafeFetchable('https://example.com/recipe')).rejects.toThrow(
        InvalidRecipeUrlException,
      );
    });
  });

  describe('isHostSafe', () => {
    it('returns true only when every resolved address is public', async () => {
      mockLookup.mockResolvedValue(addresses('93.184.216.34'));
      await expect(service.isHostSafe('example.com')).resolves.toBe(true);

      mockLookup.mockResolvedValue(addresses('10.0.0.1'));
      await expect(service.isHostSafe('internal.example.com')).resolves.toBe(false);
    });

    it('returns false when DNS resolution fails', async () => {
      mockLookup.mockRejectedValue(new Error('NXDOMAIN'));

      await expect(service.isHostSafe('missing.example.com')).resolves.toBe(false);
    });
  });
});
