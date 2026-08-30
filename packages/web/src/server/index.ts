import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, extname, resolve, sep } from 'node:path'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { createOryhApiHandler } from './http.js'
import { createLocalOryhRemote } from './local-host.js'

const host = '127.0.0.1'
const port = resolvePort(process.env.ORYH_CLIENT_PORT)
const origin = `http://${host}:${port}`
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const assetDirectory = resolve(packageRoot, 'dist')
const development = process.env.ORYH_WEB_DEV === '1'
const remote = createLocalOryhRemote(process.env.ORYH_CLIENT_DATA_DIR)
const api = createOryhApiHandler(remote, { expectedOrigin: origin })
const vite = development ? await createViteServer({ root: packageRoot, server: { middlewareMode: true } }) : undefined

const server = createServer(async (request, response) => {
  if (new URL(request.url ?? '/', origin).pathname.startsWith('/api/client/')) {
    await api(request, response)
    return
  }
  if (vite !== undefined) {
    await serveVite(vite, request, response)
    return
  }
  await serveAsset(request, response)
})

server.listen(port, host, () => {
  console.log(`ORYH AI Client is ready at ${origin}`)
})

async function serveVite(vite: ViteDevServer, request: IncomingMessage, response: ServerResponse): Promise<void> {
  await new Promise<void>((resolveRequest, rejectRequest) => {
    vite.middlewares(request, response, (error: unknown) => {
      if (error === undefined) resolveRequest()
      else rejectRequest(error)
    })
  })
}

async function serveAsset(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const rawPath = new URL(request.url ?? '/', origin).pathname
  const requested = rawPath === '/' ? undefined : resolve(assetDirectory, `.${decodeURIComponent(rawPath)}`)
  const candidate = requested !== undefined && isAssetPath(requested) ? requested : resolve(assetDirectory, 'index.html')
  try {
    const content = await readFile(candidate)
    response.writeHead(200, staticHeaders(candidate))
    response.end(content)
  } catch {
    response.writeHead(404, staticHeaders(resolve(assetDirectory, 'index.html')))
    response.end('ORYH AI Client web assets are unavailable. Run pnpm build first.')
  }
}

function isAssetPath(path: string): boolean {
  return path === assetDirectory || path.startsWith(`${assetDirectory}${sep}`)
}

function staticHeaders(path: string): Record<string, string> {
  return {
    'Content-Type': mimeType(path),
    'Cache-Control': path.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  }
}

function mimeType(path: string): string {
  switch (extname(path)) {
    case '.css': return 'text/css; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.json': return 'application/json; charset=utf-8'
    case '.html': return 'text/html; charset=utf-8'
    default: return 'application/octet-stream'
  }
}

function resolvePort(value: string | undefined): number {
  if (value === undefined) return 4173
  if (!/^[1-9][0-9]{0,4}$/u.test(value)) throw new Error('ORYH_CLIENT_PORT must be a valid TCP port.')
  const port = Number(value)
  if (port > 65535) throw new Error('ORYH_CLIENT_PORT must be a valid TCP port.')
  return port
}
