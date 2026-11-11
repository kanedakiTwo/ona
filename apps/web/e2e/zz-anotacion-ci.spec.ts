import { expect, test } from '@playwright/test'

// PROVOCADO: comprobar que un fallo de Playwright sale como anotación (se quita en el commit siguiente)
test('anotación del CI: falla a propósito', async () => {
  expect('Hecho con Mimo').toBe('Hecho con Mimo · …/i/abc')
})
