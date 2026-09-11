import { Link } from 'react-router-dom'
import type { KeelApiError } from '../lib/keelClient'

/**
 * Errors are shown exactly as Keel sent them: `code`, `message`, Keel's own
 * `retry_advice`, and the `request_id`, which links to `explain_error` on the
 * Receipts page. Nothing here is reworded or interpreted.
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
      {/* FORBIDDEN carries the scope Keel wanted; a 403 from the event stream too. */}
      {requiredScope(error) && (
        <p className="error-advice">
          requires scope <code className="scope">{requiredScope(error)}</code>
        </p>
      )}
      {error.retryAdvice && <p className="error-advice">{error.retryAdvice}</p>}
      {error.requestId && (
        <p className="error-request-id">
          request_id{' '}
          <Link to={`/receipts?request=${encodeURIComponent(error.requestId)}`}>
            <code>{error.requestId}</code>
          </Link>
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

/** `details.required_scope`, present on FORBIDDEN and nowhere else. */
function requiredScope(error: KeelApiError): string | null {
  const details = error.details
  if (typeof details !== 'object' || details === null) return null
  const scope = (details as { required_scope?: unknown }).required_scope
  return typeof scope === 'string' ? scope : null
}
