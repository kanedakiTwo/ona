import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Load .env from monorepo root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

export const env = {
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ona',
  JWT_SECRET: process.env.JWT_SECRET || 'ona-dev-secret',
  PORT: parseInt(process.env.API_PORT || '8000', 10),
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_REALTIME_MODEL: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
  OPENAI_REALTIME_VOICE: process.env.OPENAI_REALTIME_VOICE || 'marin',
  REALTIME_DAILY_MINUTES_PER_USER: parseInt(process.env.REALTIME_DAILY_MINUTES_PER_USER || '30', 10),
}
