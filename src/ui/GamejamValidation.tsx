import { AlertCircle } from 'lucide-react';
import {
  gamejamErrorId,
  type GamejamField,
  type GamejamIssue,
} from '../gamejam-validation';

export function GamejamFieldErrors({
  field,
  issues,
}: {
  field: GamejamField;
  issues: GamejamIssue[];
}) {
  const errors = issues.filter((issue) => issue.field === field);
  if (!errors.length) return null;
  return (
    <div id={gamejamErrorId(field)} className="ai-validation-errors">
      {errors.map((issue) => (
        <p key={issue.message}>
          <AlertCircle size={14} aria-hidden="true" />
          {issue.message}
        </p>
      ))}
    </div>
  );
}

export function GamejamValidationSummary({
  issues,
  submitError,
  focusIssue,
}: {
  issues: GamejamIssue[];
  submitError: string;
  focusIssue: (issue: GamejamIssue) => void;
}) {
  if (!issues.length && !submitError) return null;
  return (
    <div
      id="ai-request-validation"
      className="ai-validation-summary"
      aria-live="polite"
    >
      <strong>
        {submitError
          ? '작업을 준비하지 못했습니다'
          : `실행 전 확인할 항목 ${issues.length}개`}
      </strong>
      {submitError && <p role="alert">{submitError}</p>}
      {!!issues.length && (
        <ul>
          {issues.map((issue) => (
            <li key={`${issue.field}:${issue.message}`}>
              <button type="button" onClick={() => focusIssue(issue)}>
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
