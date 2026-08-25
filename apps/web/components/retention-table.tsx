import { RETENTION_SUMMARY } from "../lib/retention-copy";

export function RetentionTable() {
  return (
    <dl className="flex flex-col gap-4">
      {RETENTION_SUMMARY.map((row) => (
        <div key={row.question} className="rounded-bubble border border-text-muted/20 bg-bg-surface p-4">
          <dt className="font-medium text-text-primary">{row.question}</dt>
          <dd className="mt-1 text-sm text-text-muted">{row.answer}</dd>
        </div>
      ))}
    </dl>
  );
}
