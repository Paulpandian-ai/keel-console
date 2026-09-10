import { describe, expect, it } from 'vitest'
import { SseDecoder } from './sse'

describe('SseDecoder', () => {
  it('decodes a frame terminated by a blank line', () => {
    const frames = new SseDecoder().push('event: append\ndata: {"seq":71}\n\n')
    expect(frames).toEqual([{ data: '{"seq":71}', event: 'append', id: undefined, retry: undefined }])
  })

  it('joins multi-line data with newlines', () => {
    const [frame] = new SseDecoder().push('data: one\ndata: two\n\n')
    expect(frame.data).toBe('one\ntwo')
  })

  it('reassembles a frame split across chunks', () => {
    const decoder = new SseDecoder()
    expect(decoder.push('data: {"se')).toEqual([])
    expect(decoder.push('q":72}\n')).toEqual([])
    const frames = decoder.push('\n')
    expect(JSON.parse(frames[0].data)).toEqual({ seq: 72 })
  })

  it('emits several frames from one chunk', () => {
    const frames = new SseDecoder().push('data: a\n\ndata: b\n\ndata: c\n\n')
    expect(frames.map((f) => f.data)).toEqual(['a', 'b', 'c'])
  })

  it('ignores comment keep-alives', () => {
    expect(new SseDecoder().push(': ping\n\n')).toEqual([])
  })

  it('handles CRLF line endings', () => {
    const [frame] = new SseDecoder().push('event: tick\r\ndata: 1\r\n\r\n')
    expect(frame).toMatchObject({ event: 'tick', data: '1' })
  })

  it('keeps the id and retry fields', () => {
    const [frame] = new SseDecoder().push('id: 42\nretry: 3000\ndata: x\n\n')
    expect(frame).toMatchObject({ id: '42', retry: 3000 })
  })

  it('strips only one leading space after the colon', () => {
    const [frame] = new SseDecoder().push('data:  padded\n\n')
    expect(frame.data).toBe(' padded')
  })

  it('flushes a frame that never got its blank line', () => {
    const decoder = new SseDecoder()
    expect(decoder.push('data: tail\n')).toEqual([])
    expect(decoder.flush()).toMatchObject({ data: 'tail' })
  })
})
