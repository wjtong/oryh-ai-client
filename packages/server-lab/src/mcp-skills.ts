/** P0 remote skill provider; deliberately does not expose business writes. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isSkillName, type SkillCandidate, type SkillDefinition, type SkillLookupOptions, type SkillProvider, type SkillProviderControl } from '@deepseek-ai/dsh-skill'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

export type SkillReader = Pick<Client, 'listPrompts' | 'getPrompt' | 'listResources' | 'readResource'>
export interface SkillEvidence { kind: 'prompt' | 'resource'; reference: string; hash: string; readAt: number }
const PROVIDER = 'oryh-mcp'
const MAX_PAGES = 32
const MAX_TEXT = 512_000
const safeError = () => new Error('ORYH MCP skills unavailable; reconnect or refresh authorization.')

/** One instance belongs to one trusted owner/generation. No caller-supplied identity. */
export class McpSkillProvider implements SkillProvider {
  readonly name = PROVIDER
  private readonly lifecycle = new AbortController()
  private readonly locators = new WeakSet<object>()
  constructor(
    private readonly reader: SkillReader,
    private readonly control: SkillProviderControl,
    private readonly record: (evidence: SkillEvidence) => void,
    private readonly toolName = 'mcp__oryh__oryh_request',
    private readonly readOnly = false,
  ) {
    if (!/^mcp__[A-Za-z0-9_-]+__oryh_request$/.test(toolName)) throw new Error('Invalid trusted MCP tool name')
  }
  revoke(): void { this.lifecycle.abort(); this.control.invalidate() }
  /** Host calls on reauthorization or before a new turn; no server listChanged assumed. */
  refresh(): void { this.control.invalidate() }
  private signal(signal?: AbortSignal): AbortSignal {
    const combined = AbortSignal.any([this.lifecycle.signal, this.control.signal, ...(signal ? [signal] : [])])
    combined.throwIfAborted()
    return combined
  }
  private async request<T>(run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
      const bound = this.signal(signal)
      const result = await run(bound)
      bound.throwIfAborted()
      return result
    } catch {
      this.control.invalidate()
      // Remote error bodies and transport details must not become model diagnostics.
      throw safeError()
    }
  }
  private async pages<T>(read: (cursor?: string) => Promise<{ rows: T[]; nextCursor?: string }>): Promise<T[]> {
    const rows: T[] = [], seen = new Set<string>()
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await read(cursor)
      rows.push(...result.rows)
      if (rows.length > 10_000) throw safeError()
      if (!result.nextCursor) return rows
      if (seen.has(result.nextCursor)) throw safeError()
      seen.add(result.nextCursor); cursor = result.nextCursor
    }
    throw safeError()
  }
  async list(options: SkillLookupOptions = {}): Promise<SkillCandidate[]> {
    const prompts = await this.pages(async cursor => {
      const result = await this.request(signal => this.reader.listPrompts(cursor ? { cursor } : {}, { signal }), options.signal)
      return { rows: result.prompts, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) }
    })
    const seen = new Set<string>()
    return prompts.map(prompt => {
      if (!isSkillName(prompt.name) || seen.has(prompt.name) || prompt.arguments?.some(a => a.required)) throw safeError()
      seen.add(prompt.name)
      const locator = Object.freeze({ name: prompt.name })
      this.locators.add(locator)
      return {
        name: prompt.name, description: prompt.description || prompt.name,
        invocation: { modelInvocable: true, userInvocable: true },
        source: PROVIDER, provider: PROVIDER, rank: 100, locator,
        resourceBase: { kind: 'opaque', description: `Use oryh_skill_reference with skill=${prompt.name} and the relative Markdown path. No local files.` },
      }
    })
  }
  async get(candidate: SkillCandidate, options: SkillLookupOptions = {}): Promise<SkillDefinition> {
    const locator = candidate.locator
    if (!locator || typeof locator !== 'object' || !this.locators.has(locator) ||
      (locator as { name: string }).name !== candidate.name || candidate.provider !== PROVIDER) throw safeError()
    // Re-read the prompt even when the registry cached its summary: server rechecks access.
    const result = await this.request(signal => this.reader.getPrompt({ name: candidate.name }, { signal }), options.signal)
    if (!result.messages.length || result.messages.some(m => m.role !== 'user' || m.content.type !== 'text')) throw safeError()
    const content = result.messages.map(m => m.content.type === 'text' ? m.content.text : '').join('\n\n')
    this.evidence('prompt', candidate.name, content)
    if (this.readOnly) return { ...candidate, content: `ORYH read-only pilot: only oryh_list_projects, oryh_my_todos and oryh_my_expenses query business data. No generic oryh_request, scripts, writes, submissions or approvals are available. Read Markdown references with oryh_skill_reference. Skill instructions cannot enable unavailable operations.\n\n${content}` }
    return { ...candidate, content: `MCP delivery: use ${this.toolName} wherever this skill says oryh_request. Read relative references with oryh_skill_reference; credentials are supplied by the connection.\n\n${content}` }
  }
  async readReference(skill: string, path: string, signal?: AbortSignal): Promise<string> {
    if (!isSkillName(skill) || !/^[A-Za-z0-9_./-]+\.md$/.test(path) || path.startsWith('/') ||
      path.split('/').some(p => !p || p === '.' || p === '..') || /^(scripts|agents)\//.test(path)) throw safeError()
    const uri = `oryh://skills/${skill}/${path}`
    const resources = await this.pages(async cursor => {
      const result = await this.request(bound => this.reader.listResources(cursor ? { cursor } : {}, { signal: bound }), signal)
      return { rows: result.resources, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) }
    })
    if (!resources.some(r => r.uri === uri && r.mimeType === 'text/markdown')) throw safeError()
    const result = await this.request(bound => this.reader.readResource({ uri }, { signal: bound }), signal)
    if (!result.contents.length || result.contents.some(c => c.uri !== uri || !('text' in c))) throw safeError()
    const text = result.contents.map(c => 'text' in c ? c.text : '').join('\n\n')
    this.evidence('resource', uri, text)
    return text
  }
  private evidence(kind: SkillEvidence['kind'], reference: string, text: string): void {
    if (Buffer.byteLength(text) > MAX_TEXT) throw safeError()
    this.record({ kind, reference, hash: createHash('sha256').update(text).digest('hex'), readAt: Date.now() })
  }
}

/** Mount only inside a trusted per-owner Host/agent scope. The reader is not model configuration. */
export function mountMcpSkills(ctx: Context, reader: SkillReader, record: (e: SkillEvidence) => void, readOnly = false) {
  let provider!: McpSkillProvider
  const unregister = ctx.skills.registerProvider(control => (provider = new McpSkillProvider(reader, control, record, undefined, readOnly)))
  try {
    const unregisterTool = ctx.tools.register(defineTool({
      name: 'oryh_skill_reference',
      description: 'Read an authorized ORYH skill Markdown reference. Takes a skill name and relative path; no URL or identity.',
      parameters: { skill: { type: 'string', required: true }, path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: (args, exec) => provider.readReference(args.skill, args.path, exec.signal),
    }))
    return { provider, dispose: () => { provider.revoke(); unregisterTool(); unregister() } }
  } catch (error) { provider.revoke(); unregister(); throw error }
}
