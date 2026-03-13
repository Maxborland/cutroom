import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We mock DNS to avoid real network calls.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

import * as dns from 'node:dns/promises'
import { assertSafeRemoteUrl, downloadRemoteToBuffer } from '../../server/lib/safe-remote-fetch.js'

describe('safe-remote-fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects disallowed protocols', async () => {
    await expect(assertSafeRemoteUrl('file:///etc/passwd')).rejects.toThrow(/Disallowed URL protocol/i)
    await expect(assertSafeRemoteUrl('ftp://example.com/a')).rejects.toThrow(/Disallowed URL protocol/i)
  })

  it('rejects localhost hostnames and private/reserved IP literals', async () => {
    await expect(assertSafeRemoteUrl('http://localhost:8080/a')).rejects.toThrow(/Disallowed hostname/i)

    // IPv4 private/reserved
    await expect(assertSafeRemoteUrl('http://127.0.0.1:8080/a')).rejects.toThrow(/private ip/i)
    await expect(assertSafeRemoteUrl('http://10.0.0.1/a')).rejects.toThrow(/private ip/i)
    await expect(assertSafeRemoteUrl('http://192.168.1.1/a')).rejects.toThrow(/private ip/i)
    await expect(assertSafeRemoteUrl('http://169.254.10.10/a')).rejects.toThrow(/private ip/i)
    await expect(assertSafeRemoteUrl('http://224.0.0.1/a')).rejects.toThrow(/private ip/i)
    await expect(assertSafeRemoteUrl('http://198.18.0.1/a')).rejects.toThrow(/private ip/i)
    await expect(assertSafeRemoteUrl('http://192.0.0.1/a')).rejects.toThrow(/private ip/i)
    await expect(assertSafeRemoteUrl('http://255.255.255.255/a')).rejects.toThrow(/private ip/i)

    // IPv6 loopback/unspecified + IPv4-mapped
    await expect(assertSafeRemoteUrl('http://[::1]/a')).rejects.toThrow(/private ip/i)
    await expect(assertSafeRemoteUrl('http://[::]/a')).rejects.toThrow(/private ip/i)
    await expect(assertSafeRemoteUrl('http://[::ffff:127.0.0.1]/a')).rejects.toThrow(/private ip/i)
  })

  it('rejects hostnames that resolve to private IPs', async () => {
    ;(dns.lookup as any).mockResolvedValueOnce([{ address: '10.0.0.2', family: 4 }])
    await expect(assertSafeRemoteUrl('https://evil.example/a')).rejects.toThrow(/resolves to private/i)
  })

  it('allows hostnames that resolve to public IPs', async () => {
    ;(dns.lookup as any).mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    const parsed = await assertSafeRemoteUrl('https://example.com/a')
    expect(parsed.hostname).toBe('example.com')
  })

  it('rejects redirects to private hosts', async () => {
    ;(dns.lookup as any).mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Map([['location', 'http://127.0.0.1/secret']]) as any,
      })

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await expect(downloadRemoteToBuffer('https://example.com/a', { maxRedirects: 1, maxBytes: 1024 })).rejects.toThrow(/private ip/i)
  })

  it('enforces maxBytes via content-length header', async () => {
    ;(dns.lookup as any).mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: (k: string) => (k.toLowerCase() === 'content-length' ? '2048' : null),
      },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
    })

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await expect(downloadRemoteToBuffer('https://example.com/a', { maxBytes: 1024 })).rejects.toThrow(/too large/i)
  })
})
