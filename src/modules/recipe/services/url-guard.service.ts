import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { InvalidRecipeUrlException } from '../../../common/exceptions/index';

const PRIVATE_IPV4_PATTERNS: Array<(parts: number[]) => boolean> = [
  (p) => p[0] === 10,
  (p) => p[0] === 127,
  (p) => p[0] === 0,
  (p) => p[0] === 169 && p[1] === 254, // link-local
  (p) => p[0] === 172 && p[1] >= 16 && p[1] <= 31,
  (p) => p[0] === 192 && p[1] === 168,
  (p) => p[0] === 100 && p[1] >= 64 && p[1] <= 127, // CGNAT
  (p) => p[0] >= 224, // multicast + reserved
];

/**
 * URL validation for server-side fetching. Rejects anything that could reach
 * infrastructure: non-https schemes, credentials in the URL, and — after DNS
 * resolution — loopback/private/link-local/reserved addresses (re-checked on
 * every redirect hop by the fetcher).
 */
@Injectable()
export class UrlGuardService {
  /** Throws InvalidRecipeUrlException unless the URL is safe to fetch. */
  async assertSafeFetchable(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new InvalidRecipeUrlException('url is not a valid URL.');
    }

    if (url.protocol !== 'https:') {
      throw new InvalidRecipeUrlException('Only https:// URLs can be imported.');
    }
    if (url.username || url.password) {
      throw new InvalidRecipeUrlException('URLs with credentials are not allowed.');
    }

    const addresses = await this.resolveHost(url.hostname);
    for (const address of addresses) {
      if (this.isForbiddenIp(address)) {
        throw new InvalidRecipeUrlException('This URL points to a non-public address.');
      }
    }

    return url;
  }

  async isHostSafe(hostname: string): Promise<boolean> {
    try {
      const addresses = await this.resolveHost(hostname);
      return addresses.every((address) => !this.isForbiddenIp(address));
    } catch {
      return false;
    }
  }

  private async resolveHost(hostname: string): Promise<string[]> {
    const addresses: string[] = [];
    // URL keeps IPv6 literals bracketed; isIP() needs them stripped.
    const host = hostname.replace(/^\[|\]$/g, '');

    if (isIP(host)) {
      addresses.push(host);
    } else {
      const records = await lookup(host, { all: true, verbatim: true });
      addresses.push(...records.map((record) => record.address));
    }

    if (addresses.length === 0) {
      throw new InvalidRecipeUrlException('URL host could not be resolved.');
    }
    return addresses;
  }

  private isForbiddenIp(address: string): boolean {
    const ipv4 = this.asIpv4(address);
    if (ipv4) {
      const parts = ipv4.split('.').map(Number);
      return PRIVATE_IPV4_PATTERNS.some((matches) => matches(parts));
    }

    const lower = address.toLowerCase();
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') || // unique local
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb') || // link-local
      lower.startsWith('ff') || // multicast
      lower.startsWith('::ffff:') // IPv4-mapped, e.g. ::ffff:127.0.0.1
    );
  }

  private asIpv4(address: string): string | null {
    return isIP(address) === 4 ? address : null;
  }
}
