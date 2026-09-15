/** Synthetic session round-trip only. Never included in the shipped Profile. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { SessionId, SessionSeq, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-persistence-jsonl'
import type {} from '@deepseek-ai/dsh-client-connection'

export function mountSessionProbe(ctx: Context, cwd: string) {
  ctx.connection.fetch.register({ path: '/api/p0-session', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: async request => {
    if (request.method === 'POST') {
      const id = SessionId(randomUUID())
      const handle = await ctx.sessionPersistence.create({ id, version: SESSION_FORMAT_VERSION, cwd, createdAt: Date.now(), isSeeded: false })
      try {
        const user = createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '测试：明天填写工时。' }] })
        const answer = createMessage({ role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: '这是持久化测试回复，未调用模型。' }] })
        const events: SessionEvent[] = [
          { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
          { type: 'step/start', seq: SessionSeq(1), time: 2, data: { turn: 1, step: 1 } },
          { type: 'user/message', seq: SessionSeq(2), time: 3, data: user, surfaceOp: 'append' },
          { type: 'assistant/message', seq: SessionSeq(3), time: 4, surfaceOp: 'append', data: { turn: 1, step: 1, message: answer, stream: [] } },
          { type: 'step/end', seq: SessionSeq(4), time: 5, data: { turn: 1, step: 1 } },
          { type: 'turn/end', seq: SessionSeq(5), time: 6, data: { turn: 1, reason: { kind: 'completed' } } },
        ]
        await handle.append(events)
        await handle.flush()
        return Response.json({ id, events })
      } finally { await handle.close() }
    }
    const id = new URL(request.url).searchParams.get('id')
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 })
    try {
      const reader = await ctx.sessionPersistence.open(SessionId(id), 'read')
      try { const { events } = await reader.read(); return Response.json({ id, events }) }
      finally { await reader.close() }
    } catch { return new Response('Session unavailable', { status: 404 }) }
  } })
}
