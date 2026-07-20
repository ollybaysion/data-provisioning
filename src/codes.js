// Report code — 안정 enum(schemas/report.schema.json 과 같은 값·같은 순서).
// 배열 순서가 곧 severity 오름차순이며, 여러 발견이 겹치면 code 에는 최상위가 온다.

export const CODES = [
  "OK",
  "ZERO_ROWS",
  "INTEGRITY_ABSENT",
  "TIME_MIXED",
  "TRUNCATED_PASTE",
  "ROWCOUNT_MISMATCH",
  "COLUMN_MISMATCH",
  "IDENTITY_MISMATCH",
  "ENCODING_UNDECIDABLE",
  "PARTIAL_MARKING",
  "MERGE_CONFLICT",
];

/** 치명 = model 을 돌려주지 않는다. 비치명 = model 과 함께 경고로 나간다. */
export const FATAL = new Set([
  "TRUNCATED_PASTE",
  "ROWCOUNT_MISMATCH",
  "COLUMN_MISMATCH",
  "IDENTITY_MISMATCH",
  "ENCODING_UNDECIDABLE",
  "PARTIAL_MARKING",
  "MERGE_CONFLICT",
]);

export const isFatal = (code) => FATAL.has(code);
export const severity = (code) => CODES.indexOf(code);

/** 발견 목록 → Report. 최상위 severity 가 code 가 되고 나머지는 warnings 로 간다. */
export function toReport(findings) {
  if (findings.length === 0) return { code: "OK", message: "정상" };
  const sorted = [...findings].sort(
    (a, b) => severity(b.code) - severity(a.code),
  );
  const [head, ...rest] = sorted;
  const report = { code: head.code, message: head.message };
  if (head.query_id) report.query_id = head.query_id;
  if (head.where) report.where = head.where;
  if (rest.length > 0) report.warnings = rest;
  return report;
}
