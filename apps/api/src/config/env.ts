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
}
