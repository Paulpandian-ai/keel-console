/**
 * Minimal Server-Sent Events decoder.
 *
 * The browser's native `EventSource` cannot send an `Authorization` header, and
 * Keel requires a bearer token on `/events/stream`, so the console reads the
 * stream with `fetch` and decodes the frames here. Kept pure so it is testable
 * without a network.
 */

export interface SseFrame {
  event?: string
  data: string
  id?: string
  retry?: number
}

export class SseDecoder {
  private buffer = ''

  /** Feed a chunk of the response body; returns whatever frames it completed. */
  push(chunk: string): SseFrame[] {
    this.buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const frames: SseFrame[] = []

    let boundary = this.buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const block = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + 2)
      const frame = decodeBlock(block)
      if (frame) frames.push(frame)
      boundary = this.buffer.indexOf('\n\n')
    }

    return frames
  }

  /** Flush a trailing frame that was not terminated by a blank line. */
  flush(): SseFrame | null {
    const block = this.buffer
    this.buffer = ''
    return block.trim() === '' ? null : decodeBlock(block)
  }
}

function decodeBlock(block: string): SseFrame | null {
  const dataLines: string[] = []
  let event: string | undefined
  let id: string | undefined
  let retry: number | undefined

  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue // comment / keep-alive

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    switch (field) {
      case 'data':
        dataLines.push(value)
        break
      case 'event':
        event = value
        break
      case 'id':
        id = value
        break
      case 'retry': {
        const parsed = Number.parseInt(value, 10)
        if (Number.isFinite(parsed)) retry = parsed
        break
      }
      default:
        break
    }
  }

  if (dataLines.length === 0 && event === undefined && id === undefined) return null
  return { data: dataLines.join('\n'), event, id, retry }
}
