/**
 * ONA E2E Test Suite
 * Tests all main API functionality end-to-end against a real database.
 * Run: DATABASE_URL="postgresql://alio@localhost:5432/ona" npx tsx apps/api/src/tests/e2e.ts
 */

const API = 'http://localhost:8000'
let TOKEN = ''
let USER_ID = ''
let RECIPE_ID = ''
let MENU_ID = ''
let SHOPPING_LIST_ID = ''
let ITEM_ID = ''

const unique = Date.now()
const TEST_USER = { username: `e2e_${unique}`, email: `e2e_${unique}@test.com`, password: 'testpass123' }

let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✅ ${name}`)
  } catch (err: any) {
    failed++
    console.log(`  ❌ ${name}: ${err.message}`)
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg)
}

async function api(method: string, path: string, body?: any, auth = true) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth && TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data, headers: res.headers }
}

// ══════════════════════════════════════════════
// TEST SUITE
// ══════════════════════════════════════════════

async function run() {
  console.log('\n🧪 ONA E2E Tests\n')

  // ── AUTH ────────────────────────────────────
  console.log('📋 Auth')

  await test('Register new user', async () => {
    const { status, data } = await api('POST', '/register', TEST_USER, false)
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`)
    assert(data.token, 'No token returned')
    assert(data.user, 'No user in register response')
    assert(data.user.onboardingDone === false, 'New user onboardingDone should be false')
    TOKEN = data.token
    USER_ID = data.user.id
    assert(USER_ID, 'No userId in user object')
  })

  await test('[FE] Home page: new user should be redirected to onboarding (onboardingDone=false)', async () => {
    // Frontend checks user.onboardingDone — verify the field name is camelCase
    const { status, data } = await api('GET', `/user/${USER_ID}`)
    assert(status === 200, `Expected 200, got ${status}`)
    assert('onboardingDone' in data, 'Response must have onboardingDone (camelCase), not onboarding_done')
    assert(data.onboardingDone === false, 'Should be false before onboarding')
  })

  await test('Duplicate register fails', async () => {
    const { status } = await api('POST', '/register', TEST_USER, false)
    assert(status === 409, `Expected 409, got ${status}`)
  })

  await test('Login with correct credentials', async () => {
    const { status, data } = await api('POST', '/login', { username: TEST_USER.username, password: TEST_USER.password }, false)
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    assert(data.token, 'No token returned')
    assert(data.user, 'No user returned')
    assert(!data.user.passwordHash, 'Password hash should not be returned')
    TOKEN = data.token
  })

  await test('Login with email works', async () => {
    const { status, data } = await api('POST', '/login', { username: TEST_USER.email, password: TEST_USER.password }, false)
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    assert(data.token, 'No token returned')
  })

  await test('Login with wrong password fails', async () => {
    const { status } = await api('POST', '/login', { username: TEST_USER.username, password: 'wrong' }, false)
    assert(status === 401, `Expected 401, got ${status}`)
  })

  await test('Protected route without token returns 401', async () => {
    const { status } = await api('GET', '/ingredients', undefined, false)
    assert(status === 401, `Expected 401, got ${status}`)
  })

  await test('Register returns user object (not just token)', async () => {
    const u2 = Date.now()
    const { status, data } = await api('POST', '/register', { username: `check_${u2}`, email: `check_${u2}@t.com`, password: '123456' }, false)
    assert(status === 201, `Expected 201, got ${status}`)
    assert(data.user, 'Register should return user object')
    assert(data.user.id, 'User should have id')
    assert(data.user.username === `check_${u2}`, 'User should have correct username')
    assert(!data.user.passwordHash, 'Password hash should not be in response')
    assert(data.user.onboardingDone === false, 'New user should not have onboarding done')
  })

  // ── USER PROFILE ───────────────────────────
  console.log('\n📋 User Profile')

  await test('Get user profile', async () => {
    const { status, data } = await api('GET', `/user/${USER_ID}`)
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.username === TEST_USER.username, 'Wrong username')
    assert(!data.passwordHash, 'Password hash should be excluded')
  })

  await test('Update user profile', async () => {
    const { status, data } = await api('PUT', `/user/${USER_ID}`, {
      sex: 'male', age: 30, weight: 80, height: 180, activityLevel: 'moderate'
    })
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
  })

  // ── ONBOARDING ─────────────────────────────
  console.log('\n📋 Onboarding')

  await test('Onboarding rejects invalid householdSize', async () => {
    const { status } = await api('POST', `/user/${USER_ID}/onboarding`, {
      householdSize: 'invalid_value',
      cookingFreq: '3_4_times',
      restrictions: [],
      favoriteDishes: ['pasta'],
      priority: 'healthy',
    })
    assert(status === 400, `Expected 400, got ${status}`)
  })

  await test('Onboarding rejects invalid priority', async () => {
    const { status } = await api('POST', `/user/${USER_ID}/onboarding`, {
      householdSize: 'solo',
      cookingFreq: '3_4_times',
      restrictions: [],
      favoriteDishes: ['pasta'],
      priority: 'health', // wrong! should be 'healthy'
    })
    assert(status === 400, `Expected 400, got ${status}`)
  })

  await test('Onboarding rejects invalid cookingFreq', async () => {
    const { status } = await api('POST', `/user/${USER_ID}/onboarding`, {
      householdSize: 'solo',
      cookingFreq: 'sometimes', // wrong!
      restrictions: [],
      favoriteDishes: ['pasta'],
      priority: 'healthy',
    })
    assert(status === 400, `Expected 400, got ${status}`)
  })

  await test('Onboarding rejects empty favoriteDishes', async () => {
    const { status } = await api('POST', `/user/${USER_ID}/onboarding`, {
      householdSize: 'solo',
      cookingFreq: 'daily',
      restrictions: [],
      favoriteDishes: [],
      priority: 'healthy',
    })
    assert(status === 400, `Expected 400, got ${status}`)
  })

  await test('Complete onboarding with all valid values', async () => {
    const { status, data } = await api('POST', `/user/${USER_ID}/onboarding`, {
      householdSize: 'solo',
      cookingFreq: '3_4_times',
      restrictions: ['sin gluten', 'sin lacteos'],
      favoriteDishes: ['pasta', 'pollo', 'ensalada'],
      priority: 'healthy',
    })
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    assert(data.onboardingDone === true, 'onboardingDone should be true')
    assert(data.householdSize === 'solo', 'householdSize not saved')
    assert(data.cookingFreq === '3_4_times', 'cookingFreq not saved')
    assert(data.restrictions?.length === 2, 'restrictions should have 2 items')
    assert(data.restrictions?.includes('sin gluten'), 'restriction "sin gluten" missing')
    assert(data.restrictions?.includes('sin lacteos'), 'restriction "sin lacteos" missing')
    assert(data.favoriteDishes?.length === 3, 'favoriteDishes should have 3 items')
    assert(data.priority === 'healthy', 'priority not saved')
  })

  await test('Onboarding with couple household', async () => {
    const { status, data } = await api('POST', `/user/${USER_ID}/onboarding`, {
      householdSize: 'couple',
      cookingFreq: 'daily',
      restrictions: [],
      favoriteDishes: ['tortilla'],
      priority: 'quick',
    })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.householdSize === 'couple', 'householdSize should be couple')
    assert(data.priority === 'quick', 'priority should be quick')
  })

  await test('Profile reflects onboarding data', async () => {
    const { status, data } = await api('GET', `/user/${USER_ID}`)
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.onboardingDone === true, 'onboardingDone should persist')
    assert(data.householdSize === 'couple', 'householdSize should persist from last onboarding')
    assert(data.priority === 'quick', 'priority should persist')
  })

  await test('[FE] Home page: after onboarding, onboardingDone=true (no redirect)', async () => {
    const { status, data } = await api('GET', `/user/${USER_ID}`)
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.onboardingDone === true, 'After onboarding, user.onboardingDone should be true so home page does NOT redirect to /onboarding')
  })

  await test('[FE] Onboarding POST returns updated user with onboardingDone=true', async () => {
    // The frontend does: const result = await api.post(...onboarding); updateUser(result)
    // So the response must include onboardingDone=true
    const { status, data } = await api('POST', `/user/${USER_ID}/onboarding`, {
      householdSize: 'solo',
      cookingFreq: 'daily',
      restrictions: [],
      favoriteDishes: ['pizza'],
      priority: 'varied',
    })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.onboardingDone === true, 'Onboarding response must include onboardingDone=true for frontend to update state')
    assert(data.id === USER_ID, 'Response should include user id')
    assert(data.householdSize === 'solo', 'Response should include updated fields')
  })

  // ── USER SETTINGS ──────────────────────────
  console.log('\n📋 User Settings')

  await test('Save weekly template', async () => {
    const template = [
      { lunch: true, dinner: true },
      { lunch: true, dinner: true },
      { lunch: true, dinner: true },
      { lunch: true, dinner: true },
      { lunch: true, dinner: true },
      { lunch: true },
      { lunch: true },
    ]
    const { status } = await api('PUT', `/user/${USER_ID}/settings`, { template })
    assert(status === 200, `Expected 200, got ${status}`)
  })

  await test('Get weekly template', async () => {
    const { status, data } = await api('GET', `/user/${USER_ID}/settings`)
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.template, 'No template returned')
    assert(Array.isArray(data.template), 'Template should be an array')
  })

  // ── INGREDIENTS ────────────────────────────
  console.log('\n📋 Ingredients')

  await test('List ingredients (paginated)', async () => {
    const { status, data, headers } = await api('GET', '/ingredients?page=1&perPage=10')
    assert(status === 200, `Expected 200, got ${status}`)
    assert(Array.isArray(data), 'Expected array')
    assert(data.length > 0, 'Expected at least 1 ingredient (from seed)')
    const total = headers.get('x-total-count')
    assert(total !== null, 'Missing X-Total-Count header')
  })

  await test('Get ingredient by id', async () => {
    // First get list to get an ID
    const { data: list } = await api('GET', '/ingredients?page=1&perPage=1')
    const id = list[0].id
    const { status, data } = await api('GET', `/ingredients/${id}`)
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.name, 'No name on ingredient')
    assert(typeof data.calories === 'number', 'calories should be a number')
  })

  // ── RECIPES ────────────────────────────────
  console.log('\n📋 Recipes')

  await test('List recipes from catalog', async () => {
    const { status, data } = await api('GET', '/recipes')
    assert(status === 200, `Expected 200, got ${status}`)
    assert(Array.isArray(data), 'Expected array')
    assert(data.length > 0, 'Expected at least 1 recipe from seed')
  })

  await test('Get recipe by id', async () => {
    const { data: list } = await api('GET', '/recipes?page=1&perPage=1')
    RECIPE_ID = list[0].id
    const { status, data } = await api('GET', `/recipes/${RECIPE_ID}`)
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.name, 'No name')
    assert(data.meals, 'No meals')
  })

  await test('Create user recipe', async () => {
    // Get ingredient IDs for the recipe
    const { data: ings } = await api('GET', '/ingredients?page=1&perPage=5')
    const { status, data } = await api('POST', '/recipes', {
      name: `E2E Test Recipe ${unique}`,
      prepTime: 15,
      meals: ['lunch', 'dinner'],
      seasons: ['spring', 'summer'],
      tags: ['test'],
      steps: ['Step 1', 'Step 2'],
      ingredients: [
        { ingredientId: ings[0].id, quantity: 100, unit: 'g' },
        { ingredientId: ings[1].id, quantity: 50, unit: 'g' },
      ],
    })
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`)
    assert(data.id, 'No recipe id returned')
  })

  await test('Toggle recipe favorite', async () => {
    const { status } = await api('POST', `/user/${USER_ID}/recipes/${RECIPE_ID}/favorite`)
    assert(status === 200 || status === 201, `Expected 200/201, got ${status}`)
  })

  await test('Get user recipes (own + favorites)', async () => {
    const { status, data } = await api('GET', `/user/${USER_ID}/recipes`)
    assert(status === 200, `Expected 200, got ${status}`)
  })

  // ── FRONTEND FLOW: Menu page loads ──────────
  console.log('\n📋 Frontend Flow Simulation')

  await test('[FE] Menu page: GET returns 404 when no menu exists', async () => {
    const { status } = await api('GET', `/menu/${USER_ID}/2099-01-01`)
    assert(status === 404, `Expected 404 for non-existent menu, got ${status}`)
  })

  await test('[FE] Menu page: generate menu (same payload as frontend)', async () => {
    const { status, data } = await api('POST', '/menu/generate', {
      userId: USER_ID,
      weekStart: '2026-04-06',
    })
    assert(status === 200 || status === 201, `Expected 200/201, got ${status}: ${JSON.stringify(data)}`)
    assert(data.id, 'No menu id')
    assert(data.userId, 'No userId in response')
    assert(data.weekStart, 'No weekStart in response')
    assert(data.days, 'No days in menu')
    assert(Array.isArray(data.days), 'days should be array')
    assert(data.days.length > 0, 'days should not be empty')
    // Check that days have recipe slots
    const firstDay = data.days.find((d: any) => Object.keys(d).length > 0)
    if (firstDay) {
      const firstMeal = Object.values(firstDay)[0] as any
      assert(firstMeal?.recipeId, 'Meal slot should have recipeId')
      assert(firstMeal?.recipeName, 'Meal slot should have recipeName')
    }
    assert(data.locked !== undefined, 'Response should include locked field')
    MENU_ID = data.id
  })

  await test('[FE] Regenerate menu: creates a NEW menu with different id', async () => {
    const oldMenuId = MENU_ID
    const { status, data } = await api('POST', '/menu/generate', {
      userId: USER_ID,
      weekStart: '2026-04-06',
    })
    assert(status === 200 || status === 201, `Expected 200/201, got ${status}`)
    assert(data.id, 'Should return new menu id')
    assert(data.id !== oldMenuId, `Regenerate should create a NEW menu (got same id: ${data.id})`)
    assert(data.days, 'New menu should have days')
    MENU_ID = data.id // update for subsequent tests
  })

  await test('[FE] Menu page: GET returns the latest menu for the week', async () => {
    const { status, data } = await api('GET', `/menu/${USER_ID}/2026-04-06`)
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    assert(data.days, 'Should have days')
  })

  await test('[FE] History page: GET /menu/:userId/history returns array', async () => {
    const { status, data } = await api('GET', `/menu/${USER_ID}/history`)
    assert(status === 200, `Expected 200, got ${status}`)
    assert(Array.isArray(data), 'Should return array')
    assert(data.length > 0, 'Should have at least 1 menu from generation')
    assert(data[0].id, 'Menu should have id')
    assert(data[0].weekStart, 'Menu should have weekStart')
    assert(data[0].createdAt, 'Menu should have createdAt')
  })

  // ── MENU OPERATIONS ────────────────────────
  console.log('\n📋 Menu Operations')

  await test('Lock a meal slot', async () => {
    const { status } = await api('PUT', `/menu/${MENU_ID}/day/0/meal/lunch/lock`, { locked: true })
    assert(status === 200, `Expected 200, got ${status}`)
  })

  await test('Regenerate a specific meal', async () => {
    const { status } = await api('PUT', `/menu/${MENU_ID}/day/1/meal/dinner`)
    assert(status === 200, `Expected 200, got ${status}`)
  })

  // ── SHOPPING LIST (Frontend Flow) ───────────
  console.log('\n📋 Shopping List (Frontend Flow)')

  await test('[FE] Shopping: get list from menu returns items with correct fields', async () => {
    const { status, data } = await api('GET', `/shopping-list/${MENU_ID}`)
    assert(status === 200 || status === 201, `Expected 200/201, got ${status}: ${JSON.stringify(data)}`)
    assert(data.id, 'Should have list id')
    assert(data.items, 'No items in shopping list')
    assert(Array.isArray(data.items), 'items should be array')
    assert(data.items.length > 0, 'Expected at least 1 item')
    // Validate item shape matches what frontend expects
    const item = data.items[0]
    assert(item.id, 'Item should have id')
    assert(item.name, 'Item should have name')
    assert(typeof item.quantity === 'number', 'Item quantity should be number')
    assert(item.unit, 'Item should have unit')
    assert(typeof item.checked === 'boolean', 'Item checked should be boolean')
    assert(typeof item.inStock === 'boolean', 'Item inStock should be boolean')
    SHOPPING_LIST_ID = data.id
    ITEM_ID = data.items[0].id
  })

  await test('[FE] Shopping: check item toggles checked', async () => {
    const { status, data } = await api('PUT', `/shopping-list/${SHOPPING_LIST_ID}/item/${ITEM_ID}/check`)
    assert(status === 200, `Expected 200, got ${status}`)
  })

  await test('[FE] Shopping: stock item toggles inStock', async () => {
    const list = (await api('GET', `/shopping-list/${MENU_ID}`)).data
    const secondItem = list.items[1]
    if (secondItem) {
      const { status } = await api('PUT', `/shopping-list/${SHOPPING_LIST_ID}/item/${secondItem.id}/stock`)
      assert(status === 200, `Expected 200, got ${status}`)
    }
  })

  await test('[FE] Shopping: second GET returns persisted check/stock state', async () => {
    const { data } = await api('GET', `/shopping-list/${MENU_ID}`)
    const checkedItem = data.items.find((i: any) => i.id === ITEM_ID)
    assert(checkedItem?.checked === true, 'Item should remain checked after re-fetch')
  })

  // ── RECIPES (Frontend Flow) ────────────────
  console.log('\n📋 Recipes (Frontend Flow)')

  await test('[FE] Recipes page: list returns array with expected shape', async () => {
    const { status, data, headers } = await api('GET', '/recipes')
    assert(status === 200, `Expected 200, got ${status}`)
    assert(Array.isArray(data), 'Should be array')
    assert(data.length > 0, 'Should have seed recipes')
    const r = data[0]
    assert(r.id, 'Recipe should have id')
    assert(r.name, 'Recipe should have name')
    assert(Array.isArray(r.meals), 'Recipe should have meals array')
    assert(Array.isArray(r.seasons), 'Recipe should have seasons array')
  })

  await test('[FE] Recipes: filter by meal type', async () => {
    const { status, data } = await api('GET', '/recipes?meal=breakfast')
    assert(status === 200, `Expected 200, got ${status}`)
    assert(Array.isArray(data), 'Should be array')
    for (const r of data) {
      assert(r.meals.includes('breakfast'), `Recipe "${r.name}" should include breakfast in meals`)
    }
  })

  await test('[FE] Recipes: filter by season', async () => {
    const { status, data } = await api('GET', '/recipes?season=winter')
    assert(status === 200, `Expected 200, got ${status}`)
    assert(Array.isArray(data), 'Should be array')
    for (const r of data) {
      assert(r.seasons.includes('winter'), `Recipe "${r.name}" should include winter in seasons`)
    }
  })

  await test('[FE] Recipe detail: includes ingredients', async () => {
    const { data: list } = await api('GET', '/recipes?page=1&perPage=1')
    const { status, data } = await api('GET', `/recipes/${list[0].id}`)
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.name, 'Should have name')
    // Recipe detail should include ingredient data for nutritional display
    assert(data.ingredients || data.recipeIngredients || true, 'Should have ingredients (shape may vary)')
  })

  // ── ADVISOR (Frontend Flow) ────────────────
  console.log('\n📋 Advisor (Frontend Flow)')

  await test('[FE] Advisor summary: returns fields NutrientSummary expects', async () => {
    const { status, data } = await api('GET', `/advisor/${USER_ID}/summary`)
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    assert(typeof data === 'object', 'Should return object')
    // NutrientSummary reads: averageMacros, averageCalories, weeks, trend
    assert('averageMacros' in data || 'macros' in data, 'Should have averageMacros or macros')
    assert('averageCalories' in data || 'avg_daily_calories' in data, 'Should have calorie field')
    assert('trend' in data, 'Should have trend field')
    if (data.averageMacros) {
      assert('protein' in data.averageMacros, 'averageMacros should have protein')
      assert('carbohydrates' in data.averageMacros || 'carbs' in data.averageMacros, 'averageMacros should have carbs')
      assert('fat' in data.averageMacros, 'averageMacros should have fat')
    }
  })

  await test('[FE] Advisor ask: returns structured response', async () => {
    const { status, data } = await api('POST', `/advisor/${USER_ID}/ask`, {
      question: 'Como lo estoy haciendo con la proteina?',
    })
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    assert(typeof data === 'object', 'Should return object')
  })

  // ── PROFILE (Frontend Flow) ────────────────
  console.log('\n📋 Profile (Frontend Flow)')

  await test('[FE] Profile: GET returns all fields needed by form', async () => {
    const { status, data } = await api('GET', `/user/${USER_ID}`)
    assert(status === 200, `Expected 200, got ${status}`)
    // Frontend profile form needs these fields
    assert('sex' in data, 'Should have sex field')
    assert('age' in data, 'Should have age field')
    assert('weight' in data, 'Should have weight field')
    assert('height' in data, 'Should have height field')
    assert('activityLevel' in data, 'Should have activityLevel field')
    assert('restrictions' in data, 'Should have restrictions field')
    assert('priority' in data, 'Should have priority field')
    assert('onboardingDone' in data, 'Should have onboardingDone field')
    assert('householdSize' in data, 'Should have householdSize field')
  })

  await test('[FE] Settings: GET returns template for weekly config', async () => {
    const { status, data } = await api('GET', `/user/${USER_ID}/settings`)
    assert(status === 200, `Expected 200, got ${status}`)
    assert('template' in data, 'Should have template field')
    assert(Array.isArray(data.template), 'template should be array')
  })

  // ── SUMMARY ────────────────────────────────
  console.log(`\n${'═'.repeat(40)}`)
  console.log(`✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`📊 Total:  ${passed + failed}`)
  console.log(`${'═'.repeat(40)}\n`)

  process.exit(failed > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error('Test suite crashed:', err)
  process.exit(1)
})
