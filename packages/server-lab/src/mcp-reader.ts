import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { SkillReader } from './mcp-skills.js'

/** P0 transport factory. OAuth transaction/refresh storage is still a separate trusted service. */
export async function connectSkillReader(options: {
  endpoint: string
  accessToken: () => Promise<string>
  signal: AbortSignal
  allowLoopbackForTest?: boolean
}): Promise<{ reader: SkillReader; close: () => Promise<void> }> {
  const endpoint = new URL(options.endpoint)
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/mcp' ||
    (endpoint.protocol !== 'https:' && !(options.allowLoopbackForTest && endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1'))) {
    throw new Error('Invalid trusted ORYH MCP endpoint')
  }
  const lifecycle = new AbortController()
  const signal = AbortSignal.any([options.signal, lifecycle.signal])
  const transport = new StreamableHTTPClientTransport(endpoint, {
    fetch: async (input, init) => {
      signal.throwIfAborted()
      const url = String(input)
      if (new URL(url).href !== endpoint.href) throw new Error('MCP target rejected')
      const token = await options.accessToken()
      signal.throwIfAborted()
      const headers = new Headers(init?.headers)
      headers.delete('cookie'); headers.delete('x-api-key'); headers.set('authorization', `Bearer ${token}`)
      return fetch(endpoint, { ...init, headers, redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000), ...(init?.signal ? [init.signal] : [])]) })
    },
  })
  const client = new Client({ name: 'oryh-server-p0-skills', version: '0.1.0' })
  try {
    // SDK optional lifecycle properties differ under exactOptionalPropertyTypes.
    await client.connect(transport as Transport)
    signal.throwIfAborted()
  } catch {
    lifecycle.abort(); await client.close().catch(() => {})
    throw new Error('ORYH MCP connection failed; reconnect authorization.')
  }
  // Narrow facade: consumers cannot call tools/call or retrieve credentials.
  const reader: SkillReader = {
    listPrompts: client.listPrompts.bind(client), getPrompt: client.getPrompt.bind(client),
    listResources: client.listResources.bind(client), readResource: client.readResource.bind(client),
  }
  return { reader, close: async () => { lifecycle.abort(); await client.close() } }
}
