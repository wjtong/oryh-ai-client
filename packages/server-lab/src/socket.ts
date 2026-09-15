import { createServer, type Server } from 'node:http'
import { chmod } from 'node:fs/promises'
import { Denied, OutcomeUnknown, type Channel, type LabBroker, type Operation } from './broker.js'

/** One privately mounted socket per owner/generation. No identity or target comes from the wire. */
export async function executionSocket(path: string, broker: LabBroker, channel: Channel): Promise<Server> {
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    const fail = (status: number, message: string) => { res.writeHead(status); res.end(JSON.stringify({ error: message })) }
    if (req.method !== 'POST' || req.url !== '/execute') { fail(403, 'Request denied'); return }
    // Reject identity/credential/forwarding headers rather than silently accepting a spoof.
    if (Object.keys(req.headers).some(k => /^(authorization|cookie|x-|forwarded)/i.test(k))) { fail(403, 'Request denied'); return }
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const part of req) {
        const chunk = Buffer.from(part)
        size += chunk.length
        if (size > 16_384) { fail(413, 'Request too large'); return }
        chunks.push(chunk)
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).sort().join(',') !== 'action,body,id,kind') throw new Denied()
      const receipt = await broker.execute(channel, body as Operation)
      res.end(JSON.stringify(receipt))
    } catch (error) {
      fail(error instanceof OutcomeUnknown ? 409 : 403, error instanceof OutcomeUnknown ? error.message : 'Request denied')
    }
  })
  server.requestTimeout = 5_000
  server.headersTimeout = 5_000
  server.maxHeadersCount = 20
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve) })
  // The mounted directory is an owner-specific capability. It must never be shared across owners.
  await chmod(path, 0o666)
  return server
}
