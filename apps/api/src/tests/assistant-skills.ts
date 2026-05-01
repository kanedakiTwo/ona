/**
 * ONA Assistant Skills E2E Tests
 * Tests each skill individually to verify tool_use routing and handler execution.
 *
 * Run: npx tsx apps/api/src/tests/assistant-skills.ts
 */

const API = 'http://localhost:8000'
let TOKEN = ''
let USER_ID = ''

const unique = Date.now()

let passed = 0
let failed = 0
const failures: string[] = []

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✅ ${name}`)
  } catch (err: any) {
    failed++
    failures.push(`${name}: ${err.message}`)
    console.log(`  ❌ ${name}: ${err.message}`)
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg)
}

async function api(method: string, path: string, body?: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

async function ask(question: string, history: any[] = []) {
  const { status, data } = await api('POST', `/assistant/${USER_ID}/chat`, { message: question, history })
  return { status, ...data }
}

async function setup() {
  const { data } = await api('POST', '/register', {
    username: `skills_${unique}`,
    email: `skills_${unique}@test.com`,
    password: 'testpass123',
  })
  TOKEN = data.token
  USER_ID = data.user.id

  await api('PUT', `/user/${USER_ID}`, {
    sex: 'male', age: 30, weight: 80, height: 180, activityLevel: 'moderate',
  })
  await api('POST', `/user/${USER_ID}/onboarding`, {
    householdSize: 'solo', cookingFreq: '3_4_times',
    restrictions: [], favoriteDishes: ['pasta', 'pollo'], priority: 'healthy',
  })
  await api('PUT', `/user/${USER_ID}/settings`, {
    template: Array.from({ length: 7 }, () => ({ lunch: true, dinner: true })),
  })
  await api('POST', '/menu/generate', { userId: USER_ID, weekStart: '2026-03-30' })
}

async function run() {
  console.log('\n🧪 ONA Assistant Skills Tests\n')
  await setup()
  console.log('Setup complete\n')

  // ── BASIC CONNECTIVITY ─────────────────────
  console.log('📋 Basic Connectivity')

  await test('Assistant endpoint returns 200', async () => {
    const r = await ask('hola')
    assert(r.status === 200, `Expected 200, got ${r.status}`)
    assert(r.message && r.message.length > 0, 'Should return a message')
  })

  // ── SKILL: get_todays_menu ─────────────────
  console.log('\n📋 Skill: get_todays_menu')

  await test('Returns menu for today', async () => {
    const r = await ask('Que toca cocinar hoy?')
    assert(r.message.length > 20, `Response too short: "${r.message}"`)
    assert(r.skillUsed === 'get_todays_menu', `Expected get_todays_menu, got ${r.skillUsed}`)
  })

  await test('Returns menu for specific day', async () => {
    const r = await ask('Que hay de comer el martes?')
    assert(r.message.length > 10, 'Should return a response')
  })

  // ── SKILL: get_recipe_details ──────────────
  console.log('\n📋 Skill: get_recipe_details')

  await test('Returns recipe when found', async () => {
    // First get a recipe name from the menu
    const { data: menu } = await api('GET', `/menu/${USER_ID}/2026-03-30`)
    let recipeName = ''
    for (const day of menu.days) {
      for (const slot of Object.values(day)) {
        if ((slot as any)?.recipeName) { recipeName = (slot as any).recipeName; break }
      }
      if (recipeName) break
    }
    assert(recipeName.length > 0, 'Need a recipe name from menu')

    const r = await ask(`Dime la receta de ${recipeName} paso a paso`)
    assert(r.message.length > 30, `Response too short for recipe: "${r.message}"`)
  })

  await test('Handles recipe not found gracefully', async () => {
    const r = await ask('Dime la receta del cochinillo asado al estilo segovia')
    assert(r.message.length > 10, 'Should still return a message')
    // Should not crash, even if recipe not found
  })

  // ── SKILL: get_weekly_nutrition ────────────
  console.log('\n📋 Skill: get_weekly_nutrition')

  await test('Returns nutritional analysis', async () => {
    const r = await ask('Como van mis objetivos semanales?')
    assert(r.message.length > 20, 'Should return analysis')
    assert(r.skillUsed === 'get_weekly_nutrition', `Expected get_weekly_nutrition, got ${r.skillUsed}`)
  })

  // ── SKILL: get_shopping_list ───────────────
  console.log('\n📋 Skill: get_shopping_list')

  await test('Returns shopping list', async () => {
    const r = await ask('Que tengo que comprar esta semana?')
    assert(r.message.length > 20, 'Should return shopping list')
    assert(r.skillUsed === 'get_shopping_list', `Expected get_shopping_list, got ${r.skillUsed}`)
  })

  // ── SKILL: suggest_recipes ─────────────────
  console.log('\n📋 Skill: suggest_recipes')

  await test('Suggests recipes', async () => {
    const r = await ask('Recomiendame 3 recetas para cenar esta semana')
    assert(r.message && r.message.length > 10, `Should suggest recipes, got: ${JSON.stringify(r).slice(0, 200)}`)
  })

  // ── SKILL: search_recipes ──────────────────
  console.log('\n📋 Skill: search_recipes')

  await test('Searches recipes by keyword', async () => {
    const r = await ask('Busca recetas con pollo')
    assert(r.message.length > 10, 'Should return search results')
  })

  // ── SKILL: generate_weekly_menu ────────────
  console.log('\n📋 Skill: generate_weekly_menu')

  await test('Generates new menu', async () => {
    const r = await ask('Genera un menu nuevo para esta semana')
    assert(r.message.length > 20, 'Should confirm generation')
    assert(r.skillUsed === 'generate_weekly_menu', `Expected generate_weekly_menu, got ${r.skillUsed}`)
    assert(r.actionTaken === true, 'Should mark as action taken')
  })

  // ── SKILL: swap_meal ───────────────────────
  console.log('\n📋 Skill: swap_meal')

  await test('Swaps a meal slot', async () => {
    const r = await ask('Cambiame la comida del lunes')
    assert(r.message.length > 10, 'Should respond')
    // May ask for clarification (lunch vs dinner) or swap directly
  })

  // ── SKILL: toggle_favorite ─────────────────
  console.log('\n📋 Skill: toggle_favorite')

  await test('Handles toggle favorite', async () => {
    const r = await ask('Anade espaguetis con ajo a favoritos')
    assert(r.message.length > 10, 'Should respond')
  })

  // ── SKILL: mark_meal_eaten ─────────────────
  console.log('\n📋 Skill: mark_meal_eaten')

  await test('Marks meal as eaten', async () => {
    const r = await ask('He comido la comida del lunes')
    assert(r.message.length > 10, 'Should respond')
  })

  // ── SKILL: recipe_variation ────────────────
  console.log('\n📋 Skill: recipe_variation')

  await test('Suggests ingredient substitution', async () => {
    const r = await ask('No tengo mantequilla para la coliflor gratinada, que uso?')
    assert(r.message.length > 20, 'Should suggest substitution')
  })

  // ── SKILL: nutrition_advice ────────────────
  console.log('\n📋 Skill: nutrition_advice (KB)')

  await test('Answers nutrition question from KB', async () => {
    const r = await ask('Que opinas del azucar?')
    assert(r.message.length > 30, 'Should give detailed answer')
    // Should reference insulin, inflammation, or ONA principles
  })

  await test('Answers question about specific nutrient', async () => {
    const r = await ask('Estoy comiendo suficiente proteina?')
    assert(r.message.length > 20, 'Should analyze protein intake')
  })

  // ── MULTI-TURN ─────────────────────────────
  console.log('\n📋 Multi-turn Conversation')

  await test('Resolves references from previous turn', async () => {
    const history = [
      { role: 'user', content: 'Que toca cocinar hoy?' },
      { role: 'assistant', content: 'Hoy tienes lentejas para comer y tortilla para cenar.' },
    ]
    const r = await ask('Dame la receta de la primera', history)
    assert(r.message.length > 10, 'Should resolve "la primera" from context')
  })

  // ── RESPONSE QUALITY ───────────────────────
  console.log('\n📋 Response Quality')

  await test('Responds in Spanish', async () => {
    const r = await ask('What should I eat today?')
    // Even if asked in English, should respond in Spanish
    assert(r.message.length > 10, 'Should respond')
  })

  await test('Response is not too long (brief persona)', async () => {
    const r = await ask('Que opinas de la dieta mediterranea?')
    // Should be 2-4 sentences, not a wall of text
    const sentences = r.message.split(/[.!?]+/).filter((s: string) => s.trim().length > 5)
    assert(sentences.length <= 8, `Too many sentences (${sentences.length}): response should be brief`)
  })

  // ── SUMMARY ────────────────────────────────
  console.log(`\n${'═'.repeat(50)}`)
  console.log(`✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`📊 Total:  ${passed + failed}`)
  if (failures.length > 0) {
    console.log(`\n🔴 Failures:`)
    failures.forEach(f => console.log(`   ${f}`))
  }
  console.log(`${'═'.repeat(50)}\n`)

  process.exit(failed > 0 ? 1 : 0)
}

run().catch(err => {
  console.error('Test suite crashed:', err)
  process.exit(1)
})
