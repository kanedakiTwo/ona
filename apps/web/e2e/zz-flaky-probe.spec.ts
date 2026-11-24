import { test, expect } from '@playwright/test'

// PRO-398, temporal: falla al primer intento y pasa al reintento, para ver
// que sale en el informe de inestables. Se quita en el commit siguiente.
test('sonda de inestables (PRO-398): falla una vez', async ({}, info) => {
  expect(info.retry, 'forzado a fallar al primer intento').toBe(1)
})
