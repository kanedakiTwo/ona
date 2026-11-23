/**
 * PRO-1271 (E-93, hallazgo 1): registering an admin's email with other
 * capitals used to create a second account that the login made admin.
 * The email is now trimmed and lowercased on sign-up, compared without
 * capitals for duplicates and on login (`uq_users_email_lower` backs it),
 * and the admin role needs the exact listed email.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { registerSchema } from '@ona/shared'
import { roleForEmail } from '../services/adminEmails.js'

const base = { username: 'ana_casa', password: 'secreto123', ageConfirmed: true as const }

describe('registerSchema · el correo, en minúsculas', () => {
  it('trims and lowercases the email', () => {
    const r = registerSchema.safeParse({ ...base, email: '  Ana.Casa@Example.COM ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.email).toBe('ana.casa@example.com')
  })

  it('still rejects something that is not an email', () => {
    expect(registerSchema.safeParse({ ...base, email: 'Ana Casa' }).success).toBe(false)
  })
})

describe('roleForEmail · el rol de admin, solo con el correo exacto', () => {
  const admins = ['miguel@mimoia.com']

  it('gives admin to the listed email', () => {
    expect(roleForEmail('miguel@mimoia.com', admins)).toBe('admin')
  })

  it('never gives admin to the same email with other capitals', () => {
    expect(roleForEmail('Miguel@mimoia.com', admins)).toBe('user')
    expect(roleForEmail('MIGUEL@MIMOIA.COM', admins)).toBe('user')
  })

  it('gives user to anyone else', () => {
    expect(roleForEmail('otra@mimoia.com', admins)).toBe('user')
  })
})

describe('uq_users_email_lower · la base no deja dos cuentas con el mismo correo', () => {
  it('the migration adds a unique index on lower(email)', () => {
    const sql = readFileSync(new URL('../db/migrations/0114_email_lower_unique.sql', import.meta.url), 'utf8')
    expect(sql).toMatch(/CREATE UNIQUE INDEX "uq_users_email_lower" ON "users" USING btree \(lower\("email"\)\)/)
  })
})
