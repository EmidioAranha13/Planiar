import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../server/security/password'

describe('senhas', () => {
  it('usa Argon2id e não devolve a senha original', async () => {
    const passwordHash = await hashPassword('senha-segura1')
    expect(passwordHash.startsWith('$argon2id$')).toBe(true)
    expect(passwordHash).not.toContain('senha-segura1')
    expect(await verifyPassword('senha-segura1', passwordHash)).toBe(true)
    expect(await verifyPassword('outra-senha2', passwordHash)).toBe(false)
  })
})
