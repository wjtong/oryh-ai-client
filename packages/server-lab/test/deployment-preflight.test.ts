import { expect, it, vi } from 'vitest'
import { checkDeployment } from '../../../scripts/server-deployment-preflight.mjs'
const origin = 'https://oryh.example.test'
const authorization = { issuer: origin, authorization_endpoint: origin + '/oauth/authorize', token_endpoint: origin + '/oauth/token', revocation_endpoint: origin + '/oauth/revoke',
  response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'] }
const resource = { resource: origin + '/mcp', authorization_servers: [origin], bearer_methods_supported: ['header'] }
it('accepts pinned public metadata without sending credentials and detects a missing revoke deployment', async () => {
  const fetcher = vi.fn(async (url: string) => Response.json(url.endsWith('authorization-server') ? authorization : resource))
  expect((await checkDeployment(origin, fetcher)).passed).toBe(true)
  for (const [, options] of fetcher.mock.calls as unknown as [string, RequestInit][]) {
    expect(options.redirect).toBe('error')
    expect(options.headers).toEqual({ accept: 'application/json' })
  }
  const stale = { ...authorization, revocation_endpoint: undefined }
  const result = await checkDeployment(origin, async (url: string) => Response.json(url.endsWith('authorization-server') ? stale : resource))
  expect(result.passed).toBe(false)
  expect(result.failures).toContain('authorization.revocation_endpoint')
})
it('fails closed on TLS errors or a changed issuer without outputting response content', async () => {
  const result = await checkDeployment(origin, async () => { throw new Error('sensitive diagnostic', { cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } }) })
  expect(result.passed).toBe(false)
  expect(JSON.stringify(result)).not.toContain('sensitive diagnostic')
  const wrong = await checkDeployment(origin, async (url: string) => Response.json(url.endsWith('authorization-server') ? { ...authorization, issuer: 'https://other.example.test' } : resource))
  expect(wrong.failures).toContain('authorization.issuer')
  await expect(checkDeployment('http://oryh.example.test')).rejects.toThrow()
})
