import { describe, expect, it } from 'vitest'
import { OryhClientController } from '@oryh/ai-client-core'
import { apply } from '../src/index.js'

describe('ORYH DSH Host bundle', () => {
  it('provides the Host-only controller when its development guard is explicit', () => {
    const provided = new Map<string, unknown>()
    apply({ provide: (name, value) => {
      provided.set(name, value)
      return () => { provided.delete(name) }
    } }, { developmentOnly: true })
    expect(provided.get('oryhClient')).toBeInstanceOf(OryhClientController)
  })

  it('refuses to turn its temporary memory vault into a production credential store', () => {
    expect(() => apply({ provide: () => () => {} }, { developmentOnly: false })).toThrow(
      /OS-keychain CredentialVault adapter/,
    )
  })
})
