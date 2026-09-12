import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { unzipSync } from 'fflate'
import { OryhClientError } from '@oryh/ai-client-foundation'
import type { ConnectionId } from './brand.js'
import type { OryhHttpClient } from './http.js'

/**
 * ORYH skill bundles, installed the way ORYH documents for any agent.
 *
 * The capability an ORYH agent has is not compiled in: a tenant admin redefines business logic and
 * everyone's bundle changes. So this client downloads the same personal bundle a generic agent
 * gets, into the same place, and re-syncs when the server says it differs. Nothing here decides
 * what a skill may do — the API's own `require_permission` is the gate, and the bundle only ever
 * contains skills the holder's role already covers.
 *
 * See `docs/23-oryh-skills.md`, and ORYH's `docs/manual/connect-agent.md`.
 */

/** One skill as the server currently entitles it: what a local manifest is compared against. */
export interface SkillManifestEntry {
  readonly name: string
  readonly version?: string
  readonly hash?: string
}

/** Result of a sync attempt, shaped for a status line rather than a log. */
export interface SkillSyncResult {
  readonly installed: boolean
  readonly root: string
  readonly skills: readonly string[]
  readonly message: string
}

/** Directory names a bundle is allowed to create, so a ZIP cannot write outside the skills root. */
const SAFE_ENTRY = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/

/**
 * Reject anything that would escape the install root.
 *
 * A bundle is server-supplied data being written to disk, so entry names get checked rather than
 * trusted: no absolute paths, no `..`, no backslashes, and the resolved path must still sit under
 * the root. This is cheap and the failure mode it prevents is not.
 * @param root - absolute directory the bundle may write into.
 * @param entry - path as spelled inside the archive.
 * @returns the absolute destination path.
 */
export function resolveEntry(root: string, entry: string): string {
  if (!SAFE_ENTRY.test(entry) || entry.split('/').includes('..')) {
    throw new OryhClientError(`Refused a skill bundle entry with an unsafe name: ${entry}`, 'invalid-response')
  }
  const destination = resolve(root, entry)
  if (destination !== root && !destination.startsWith(root + sep)) {
    throw new OryhClientError(`Refused a skill bundle entry outside the skills directory: ${entry}`, 'invalid-response')
  }
  return destination
}

/** The top-level directory an entry belongs to; a bundle replaces these wholesale. */
function topLevel(entry: string): string {
  return entry.split('/')[0] ?? ''
}

/**
 * Map an archive path onto the layout the agent runtime scans.
 *
 * ORYH ships one company directory holding the skills (`<company>/<skill>/SKILL.md`), which suits
 * runtimes that walk the tree. Harness's provider scans exactly one level — it looks for
 * `<root>/<skill>/SKILL.md` — so a company directory dropped in whole is read as a single skill
 * with no SKILL.md and nothing is discovered. Lifting each skill to the root is what makes the two
 * agree, and it is safe because ORYH already names every skill after its employer, which is the
 * property that lets one agent serve two companies.
 * @param entry - path as spelled inside the archive.
 * @param skillDirs - top-level archive directories that are themselves skills.
 * @returns the install path, or undefined for company-level files that are not part of a skill.
 */
export function installPath(entry: string, skillDirs: ReadonlySet<string>): string | undefined {
  const segments = entry.split('/')
  if (segments.length < 2) return undefined
  if (skillDirs.has(segments[0]!)) return entry
  // Inside a company container: the skill directory is the second segment. Loose files directly
  // under the container (README.md, withheld.json) describe the bundle, not a skill, so they are
  // not installed — keeping them would add a directory the scanner reads as a broken skill.
  return segments.length < 3 ? undefined : segments.slice(1).join('/')
}

/**
 * Whether this client refuses to install a skill.
 *
 * ORYH ships a `*-skill-sync` skill so a generic agent can install and refresh its own bundle. Here
 * the client is the installer, so that skill is a second one — and it extracts into ORYH's nested
 * layout, which this scanner cannot read (see `installPath`). Withholding it keeps a single owner of
 * what is on disk, and keeps the agent from spending a turn following it to a `manifest.json` this
 * layout deliberately does not keep. `oryh_skill_sync` is the door instead.
 * @param skill - installed directory name, which ORYH keeps equal to the skill name.
 * @returns whether the skill is withheld from this install.
 */
export function withheld(skill: string): boolean {
  return skill.endsWith('-skill-sync')
}

export class SkillBundleService {
  /**
   * @param http - authenticated ORYH transport; the credential never leaves it.
   * @param root - absolute skills directory, scanned by the agent runtime.
   */
  constructor(private readonly http: OryhHttpClient, private readonly root: string) {}

  /** What the server says this principal is entitled to right now. */
  async manifest(connectionId: ConnectionId): Promise<readonly SkillManifestEntry[]> {
    const body = await this.http.request(connectionId, { path: '/my/skills/manifest' })
    const data = (body as { data?: unknown })?.data
    if (!Array.isArray(data)) return []
    return data.flatMap(row => {
      if (row === null || typeof row !== 'object') return []
      const entry = row as Record<string, unknown>
      return typeof entry.name === 'string'
        ? [{ name: entry.name, ...(typeof entry.version === 'string' ? { version: entry.version } : {}), ...(typeof entry.hash === 'string' ? { hash: entry.hash } : {}) }]
        : []
    })
  }

  /** What the last install recorded: the entitlement it was for, and the directories it wrote. */
  private async record(): Promise<{ manifest?: readonly SkillManifestEntry[]; installed?: readonly string[] }> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.root, '.oryh-manifest.json'), 'utf8'))
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as { manifest?: SkillManifestEntry[] } : {}
    } catch {
      return {}
    }
  }

  /** Directories the previous install owns, so a rename does not strand the old ones. */
  private async owned(): Promise<readonly string[]> {
    const installed = (await this.record()).installed
    return Array.isArray(installed) ? installed.filter(name => typeof name === 'string') : []
  }

  /**
   * Install the personal bundle when the server's entitlement differs from what is on disk.
   *
   * Comparison is by name, version and hash, which is what the server's manifest is for: it also
   * reports skills gained or lost through a role change, so a shrinking bundle syncs too.
   * @param connectionId - verified connection whose principal the bundle belongs to.
   * @param force - install even when the manifests match, for an explicit user-driven refresh.
   * @returns whether anything was written, and the skills now present.
   */
  async sync(connectionId: ConnectionId, force = false): Promise<SkillSyncResult> {
    const wanted = await this.manifest(connectionId)
    const current = (await this.record()).manifest
    const same = current !== undefined && JSON.stringify(current) === JSON.stringify(wanted)
    if (same && !force) {
      return { installed: false, root: this.root, skills: wanted.map(s => s.name), message: '技能已是最新。' }
    }
    const archive = await this.http.download(connectionId, { path: '/my/skill-bundle' })
    const files = unzipSync(archive)
    const archived = Object.keys(files).filter(name => !name.endsWith('/'))
    if (archived.length === 0) throw new OryhClientError('ORYH 返回的技能包是空的。', 'invalid-response')
    // Check the archive's own names before deciding what to install, so an unsafe entry refuses the
    // whole bundle instead of being quietly dropped by the layout mapping below.
    for (const name of archived) resolveEntry(this.root, name)
    // A top-level directory holding its own SKILL.md is already a skill (the shared connect skill);
    // anything else is the company container whose children are the skills.
    const skillDirs = new Set(archived.flatMap(name => name.split('/').length === 2 && name.endsWith('/SKILL.md') ? [topLevel(name)] : []))
    const planned = archived.flatMap(name => {
      const target = installPath(name, skillDirs)
      return target === undefined || withheld(topLevel(target)) ? [] : [[name, target] as const]
    })
    if (planned.length === 0) throw new OryhClientError('ORYH 返回的技能包里没有可安装的技能。', 'invalid-response')
    // Validate every destination before writing any of them: a partially applied bundle is worse
    // than a refused one, because the agent would then hold a mix of two versions.
    for (const [, target] of planned) resolveEntry(this.root, target)

    // Replace each installed skill directory wholesale rather than merging, so a skill withdrawn by
    // a role change actually disappears. Only directories this bundle owns are touched — the root
    // is shared with whatever else the user has installed for their other agents.
    const owned = [...new Set(planned.map(([, target]) => topLevel(target)))]
    for (const previous of await this.owned()) {
      if (!owned.includes(previous)) await rm(join(this.root, previous), { recursive: true, force: true })
    }
    for (const directory of owned) await rm(join(this.root, directory), { recursive: true, force: true })
    for (const [name, target] of planned) {
      const destination = resolveEntry(this.root, target)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, files[name]!)
    }
    await mkdir(this.root, { recursive: true })
    await writeFile(join(this.root, '.oryh-manifest.json'), JSON.stringify({ manifest: wanted, installed: owned }, null, 2))
    return { installed: true, root: this.root, skills: owned, message: `已安装 ${owned.length} 个 ORYH 技能。` }
  }
}
