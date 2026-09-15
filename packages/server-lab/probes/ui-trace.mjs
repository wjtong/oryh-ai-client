// Run the whole server locally against a synthetic ORYH, to record which Remote calls the real web UI
// makes (docs/33 batch E). Not a test fixture: it starts one real owner Host (~0.6 GB).
//
//   node packages/server-lab/probes/ui-trace.mjs <data-root>
//
// Open http://localhost:4310/ — sign-in completes on its own. Every Gateway admission decision is
// printed as `owner …: oryh-admission: allow|deny <namespace>.<method>`.
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { startControlServer } from '../lib/control-server.js'
import { startOwnerHost } from '../lib/owner-host.js'

const dataRoot = process.argv[2]
if (!dataRoot) throw new Error('usage: ui-trace.mjs <absolute data root>')
const packages = fileURLToPath(new URL('../../', import.meta.url))
const ORYH_PORT = 4311, CONTROL_PORT = 4310, MODEL_PORT = 4312
const issuer = `http://127.0.0.1:${ORYH_PORT}`

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const oryh = createServer((req, res) => {
  const url = new URL(req.url, issuer)
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    if (url.pathname === '/oauth/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri'))
      back.searchParams.set('code', 'synthetic'); back.searchParams.set('state', url.searchParams.get('state')); back.searchParams.set('iss', issuer)
      res.writeHead(303, { location: back.href }); res.end(); return
    }
    if (url.pathname === '/oauth/token') return json(res, 200, { token_type: 'Bearer', access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600 })
    if (url.pathname === '/oauth/revoke') { res.writeHead(200); res.end(); return }
    if (url.pathname === '/openapi.json') return json(res, 200, { openapi: '3.1.0', paths: {} })
    if (url.pathname === '/mcp') {
      const messages = [JSON.parse(body || '{}')].flat()
      const answer = m => ({ jsonrpc: '2.0', id: m.id, result: { tools: [], prompts: [], resources: [], protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'synthetic' } } })
      return json(res, 200, Array.isArray(JSON.parse(body || '{}')) ? messages.map(answer) : answer(messages[0]))
    }
    if (url.pathname === '/api/v1/auth/me') return json(res, 200, { data: {
      id: 'u-trace', email: 'trace@example.test', name: 'Trace', role: 'member', employee_id: 'e-trace', tenant_id: 't-trace',
      tenant: { slug: 'trace', name: '示例企业' }, environment_id: null,
      permissions: ['master_data.manage', 'expense.submit_own', 'timesheet.submit_own', 'approval.record', 'order.submit_own'],
    } })
    return json(res, 200, { data: [], meta: { total: 0, page: 1, page_size: 100, pages: 1 } })
  })
})
await new Promise(resolve => oryh.listen(ORYH_PORT, '127.0.0.1', resolve))

// A model endpoint that refuses every turn: the Chat pane still makes its session calls.
const model = createServer((req, res) => { req.resume(); req.on('end', () => json(res, 400, { error: { message: 'synthetic model' } })) })
await new Promise(resolve => model.listen(MODEL_PORT, '127.0.0.1', resolve))

const control = await startControlServer({
  publicOrigin: `http://localhost:${CONTROL_PORT}`,
  ownerDomain: `localhost:${CONTROL_PORT}`,
  servers: [{ id: 'oryh', label: 'Synthetic ORYH', issuer }],
  loopbackDevelopment: true,
  capacity: 1,
  idleMs: 60_000,
  log: line => console.log(`control: ${line}`),
  startHost: (owner, generation, signal, session) => startOwnerHost(owner, generation, signal, {
    dataRoot: join(dataRoot, 'owners'),
    bundles: { business: join(packages, 'dsh-bundle'), server: join(packages, 'server-bundle') },
    storeMasterKey: Buffer.alloc(32, 7),
    modelEnvironment: { DEEPSEEK_API_KEY: 'synthetic', DEEPSEEK_BASE_URL: `http://127.0.0.1:${MODEL_PORT}/v1` },
    origin: issuer,
    identity: session.identity,
    broker: session.broker,
    traceAdmission: true,
    log: line => console.log(`owner ${owner.slice(0, 8)}: ${line}`),
  }),
}, CONTROL_PORT)
console.log(`ui-trace: open http://localhost:${CONTROL_PORT}/`)
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void control.close().finally(() => { oryh.close(); model.close(); process.exit(0) }) })
