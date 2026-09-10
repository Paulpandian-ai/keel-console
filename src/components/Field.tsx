/** One label/value row. Values arrive from Keel already formatted. */
export default function Field({
  label,
  value,
  mono = true,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  const empty = value === null || value === undefined || value === ''
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd className={`${mono ? 'mono' : ''} ${empty ? 'muted' : ''}`}>{empty ? '—' : value}</dd>
    </div>
  )
}
