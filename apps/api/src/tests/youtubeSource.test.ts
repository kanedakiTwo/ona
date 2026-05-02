import { describe, expect, it } from 'vitest'
import {
  buildYouTubePromptInput,
  NoExtractableContentError,
  parseYouTubeVideoId,
} from '../services/sources/youtube.js'
import { detectSourceType } from '../services/sources/sourceType.js'

describe('parseYouTubeVideoId', () => {
  it('extracts the id from a watch?v= URL', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    )
  })

  it('extracts the id from a youtu.be short URL', () => {
    expect(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts the id from m.youtube.com', () => {
    expect(parseYouTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    )
  })

  it('extracts the id from youtube.com/shorts/<id>', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    )
  })

  it('preserves the id when extra query params are present', () => {
    expect(
      parseYouTubeVideoId(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc&index=2',
      ),
    ).toBe('dQw4w9WgXcQ')
  })

  it('returns null for non-YouTube URLs', () => {
    expect(parseYouTubeVideoId('https://example.com/recipe')).toBeNull()
  })

  it('returns null for malformed URLs', () => {
    expect(parseYouTubeVideoId('not a url')).toBeNull()
  })
})

describe('detectSourceType', () => {
  it('identifies youtube.com URLs as youtube', () => {
    expect(detectSourceType('https://www.youtube.com/watch?v=abc')).toBe('youtube')
  })

  it('identifies youtu.be URLs as youtube', () => {
    expect(detectSourceType('https://youtu.be/abc')).toBe('youtube')
  })

  it('identifies m.youtube.com URLs as youtube', () => {
    expect(detectSourceType('https://m.youtube.com/watch?v=abc')).toBe('youtube')
  })

  it('identifies any other host as article', () => {
    expect(detectSourceType('https://www.directoalpaladar.com/recetas/x')).toBe(
      'article',
    )
  })

  it('throws on a malformed URL', () => {
    expect(() => detectSourceType('not a url')).toThrow()
  })
})

describe('buildYouTubePromptInput', () => {
  it('combines title, description and transcript', () => {
    const out = buildYouTubePromptInput({
      title: 'Cómo hacer paella',
      description: 'Receta tradicional de paella valenciana...'.padEnd(250, ' x'),
      transcript: 'Hola a todos hoy vamos a cocinar paella...',
    })
    expect(out).toContain('Title:')
    expect(out).toContain('Cómo hacer paella')
    expect(out).toContain('Description:')
    expect(out).toContain('Transcript:')
    expect(out).toContain('Hola a todos')
  })

  it('omits the transcript section when transcript is null', () => {
    const out = buildYouTubePromptInput({
      title: 'Tortilla',
      description: 'Receta paso a paso de tortilla de patatas...'.padEnd(250, ' x'),
      transcript: null,
    })
    expect(out).toContain('Description:')
    expect(out).not.toContain('Transcript:')
  })

  it('throws NoExtractableContentError when both transcript missing and description trivial', () => {
    expect(() =>
      buildYouTubePromptInput({
        title: 'Vlog',
        description: 'corto',
        transcript: null,
      }),
    ).toThrow(NoExtractableContentError)
  })
})
