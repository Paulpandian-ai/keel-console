import type { KeelApiError } from '../lib/keelClient'

/**
 * Errors are shown exactly as Keel sent them: `code`, `message`, and the
 * `request_id` so it can be pasted into `explain_error`.
 */
export default function ErrorBlock({
  error,
  onRetry,
}: {
  error: KeelApiError
  onRetry?: () => void
}) {
  return (
    <div className="error-block" role="alert">
      <div className="error-head">
        <code className="error-code">{error.code}</code>
        {error.httpStatus !== undefined && <span className="muted">HTTP {error.httpStatus}</span>}
        {onRetry && (
          <button type="button" className="btn btn-quiet" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
      <p className="error-message">{error.message}</p>
      {error.requestId && (
        <p className="error-request-id">
          request_id <code>{error.requestId}</code>
        </p>
      )}
      {error.details !== undefined && (
        <details>
          <summary>details</summary>
          <pre>{typeof error.details === 'string' ? error.details : JSON.stringify(error.details, null, 2)}</pre>
        </details>
      )}
    </div>
  )
}
