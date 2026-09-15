// Read-only deployment contract check. No passwords, tokens, cookies, or business writes.
import { pathToFileURL } from 'node:url'
export function validateMetadata(origin, authorization, resource) {
  const failures = []
  for (const [field, path] of Object.entries({ issuer: '', authorization_endpoint: '/oauth/authorize', token_endpoint: '/oauth/token', revocation_endpoint: '/oauth/revoke' })) {
    if (authorization[field] !== origin + path) failures.push(`authorization.${field}`)
  }
  for (const [field, expected] of Object.entries({ response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'] })) {
    if (!Array.isArray(authorization[field]) || expected.some(value => !authorization[field].includes(value))) failures.push(`authorization.${field}`)
  }
  if (resource.resource !== `${origin}/mcp`) failures.push('resource.resource')
  if (!Array.isArray(resource.authorization_servers) || !resource.authorization_servers.includes(origin)) failures.push('resource.authorization_servers')
  if (!Array.isArray(resource.bearer_methods_supported) || !resource.bearer_methods_supported.includes('header')) failures.push('resource.bearer_methods_supported')
  return failures
}
export async function checkDeployment(input, fetcher = fetch) {
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.origin !== input || url.username || url.password) throw new Error('Provide an HTTPS origin without path, query or credentials')
  const paths = ['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp']
  const results = await Promise.allSettled(paths.map(async path => {
    const response = await fetcher(input + path, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP_${response.status}`)
    // Metadata is small; reject unexpectedly large responses before parsing.
    let text = '', length = 0
    const decoder = new TextDecoder()
    if (!response.body) throw new Error('EMPTY_METADATA')
    for await (const chunk of response.body) {
      length += chunk.byteLength
      if (length > 65536) throw new Error('METADATA_TOO_LARGE')
      text += decoder.decode(chunk, { stream: true })
    }
    const value = JSON.parse(text + decoder.decode())
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_METADATA')
    return value
  }))
  const failures = results.flatMap((result, index) => result.status === 'fulfilled' ? [] : [{ path: paths[index], reason: 'HTTPS or metadata request failed', code: String(result.reason?.cause?.code ?? result.reason?.code ?? 'REQUEST_FAILED') }])
  if (failures.length) return { origin: input, passed: false, checkedAt: new Date().toISOString(), failures }
  const mismatch = validateMetadata(input, results[0].value, results[1].value)
  return { origin: input, passed: mismatch.length === 0, checkedAt: new Date().toISOString(), failures: mismatch,
    scope: 'Public HTTPS metadata only; browser OAuth, MCP authorization, UI, writes and tenant isolation still require acceptance tests.' }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await checkDeployment(process.argv[2] ?? '')
    console.log(JSON.stringify(report, null, 2))
    if (!report.passed) process.exitCode = 1
  } catch {
    console.error('Usage: node scripts/server-deployment-preflight.mjs https://oryh.example.com')
    process.exitCode = 2
  }
}
