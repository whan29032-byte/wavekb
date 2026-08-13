import { describe, expect, it } from 'vitest';
import { gatewayRequestOrigin } from './gateway-origin';

describe('gatewayRequestOrigin', () => {
  it('uses the same-origin request when no canonical origin is configured', () => {
    const headers = new Headers({ host: '127.0.0.1:3100', origin: 'http://127.0.0.1:3100' });
    expect(gatewayRequestOrigin(headers, 'http://127.0.0.1:3100', '')).toBe('http://127.0.0.1:3100');
  });

  it('passes the canonical site origin to the internal gateway for a safe preview request', () => {
    const headers = new Headers({
      host: 'next-preview.wavekb.com',
      origin: 'https://next-preview.wavekb.com',
      'sec-fetch-site': 'same-origin',
      'x-forwarded-proto': 'https',
    });
    expect(gatewayRequestOrigin(headers, 'http://127.0.0.1:3100', 'https://wavekb.com')).toBe('https://wavekb.com');
  });

  it('rejects cross-origin login requests before contacting the gateway', () => {
    const headers = new Headers({ host: 'preview.wavekb.com', origin: 'https://attacker.example' });
    expect(gatewayRequestOrigin(headers, 'https://preview.wavekb.com', 'https://wavekb.com')).toBeNull();
  });

  it('rejects explicitly cross-site browser requests even without an Origin header', () => {
    const headers = new Headers({ host: 'preview.wavekb.com', 'sec-fetch-site': 'cross-site' });
    expect(gatewayRequestOrigin(headers, 'https://preview.wavekb.com', 'https://wavekb.com')).toBeNull();
  });

  it('honors forwarded host and protocol from the preview reverse proxy', () => {
    const headers = new Headers({
      host: '127.0.0.1:3100',
      origin: 'https://preview.wavekb.com',
      'x-forwarded-host': 'preview.wavekb.com',
      'x-forwarded-proto': 'https',
    });
    expect(gatewayRequestOrigin(headers, 'http://127.0.0.1:3100', '')).toBe('https://preview.wavekb.com');
  });
});
