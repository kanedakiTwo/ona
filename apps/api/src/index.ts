import express from 'express'
import cors from 'cors'
import { env } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import recipeRoutes from './routes/recipes.js'
import ingredientRoutes from './routes/ingredients.js'
import menuRoutes from './routes/menus.js'
import shoppingRoutes from './routes/shopping.js'
import advisorRoutes from './routes/advisor.js'

const app = express()

// Middleware
app.use(cors({
  origin: '*',
  exposedHeaders: ['X-Total-Count'],
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Routes
app.use(authRoutes)
app.use(userRoutes)
app.use(recipeRoutes)
app.use(ingredientRoutes)
app.use(menuRoutes)
app.use(shoppingRoutes)
app.use(advisorRoutes)

// Error handler
app.use(errorHandler)

app.listen(env.PORT, () => {
  console.log(`ONA API running on port ${env.PORT}`)
})

export default app
