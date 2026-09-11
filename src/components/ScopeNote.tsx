import { Link } from 'react-router-dom'

/**
 * Shown in place of a control Keel's `whoami` says this token cannot call.
 * The wording is careful: the console did not decide this, Keel did, and a
 * different token changes the answer.
 */
export default function ScopeNote({ tool, what }: { tool: string; what?: string }) {
  return (
    <p className="muted scope-note">
      Keel does not list <code className="tool">{tool}</code> among the tools this token may call
      {what ? `, so ${what}` : ''}. <Link to="/settings">Use a token that can</Link>.
    </p>
  )
}
