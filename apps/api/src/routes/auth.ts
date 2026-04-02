import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { eq, or } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { users } from '../db/schema.js'
import { validate } from '../middleware/validate.js'
import { registerSchema, loginSchema } from '@ona/shared'
import { env } from '../config/env.js'

const router = Router()

// POST /register
router.post('/register', validate(registerSchema), async (req, res) => {
  try {
    const { username, email, password } = req.body

    // Check username/email unique
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.username, username), eq(users.email, email)))
      .limit(1)

    if (existing.length > 0) {
      res.status(409).json({ error: 'Username or email already exists' })
      return
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const [user] = await db
      .insert(users)
      .values({ username, email, passwordHash })
      .returning()

    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET)
    const { passwordHash: _, ...userWithoutPassword } = user

    res.status(201).json({ token, user: userWithoutPassword })
  } catch (err: any) {
    console.error('Register error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
})

// POST /login
router.post('/login', validate(loginSchema), async (req, res) => {
  try {
    const { username, password } = req.body

    // Support login with username OR email
    const [user] = await db
      .select()
      .from(users)
      .where(or(eq(users.username, username), eq(users.email, username)))
      .limit(1)

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET)

    const { passwordHash, ...userWithoutPassword } = user

    res.json({ token, user: userWithoutPassword })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
