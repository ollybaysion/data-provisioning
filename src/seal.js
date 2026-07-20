// ⑥ 봉인(seal) — provenance 생성과 주체 지문.

import { sha256Text } from "./sha256.js";
import { canonJson } from "./canon.js";

/**
 * 주체 지문 — `params` + `db_id` 의 단방향 해시(v0.8 F1).
 *
 * 왜 해시인가: 모델은 데이터만 담는다는 규율(v0.7)을 지키면서도 병합이 "같은 대상인가"를
 * 스스로 검사할 수 있어야 한다. 원본 params 를 실으면 규율이 깨지고, 아무것도 안 실으면
 * round-2 delta 가 base 와 disjoint id 라서 어떤 가드도 구조적으로 못 뜬다.
 *
 * preimage 는 포트 간 재현이 목적이므로 형태를 여기서 못박는다:
 *   "db=" + db_id + "\n" + (키 코드포인트 정렬된 "k=v" 를 "\n" 으로 이은 것)
 * 값은 문자열화하고 null/undefined 는 빈 문자열로 접는다. 전부 NFC 정규화된 상태를 전제한다(§6).
 */
export function subjectFingerprint(dbId, params) {
  const entries = Object.entries(params ?? {})
    .map(([k, v]) => [
      k.normalize("NFC"),
      v === null || v === undefined ? "" : String(v).normalize("NFC"),
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const preimage =
    `db=${(dbId ?? "").normalize("NFC")}\n` +
    entries.map(([k, v]) => `${k}=${v}`).join("\n");
  return sha256Text(preimage);
}

/**
 * 쿼리 내용 해시. 우발 손상 탐지용이지 진정성 보증도, 패리티 기준도 아니다(§6·§9) —
 * 그래서 골든 구조 비교에서 제외된다. preimage 는 캐노니컬 JSON 으로 고정해 둔다.
 */
export function contentHash(columns, rows) {
  return sha256Text(canonJson({ columns, rows }));
}

export function makeProvenance({
  executedAt,
  dbId,
  subject,
  rows,
  columns,
  integrity,
  validated,
  round,
}) {
  return {
    executed_at: executedAt ?? null,
    db_id: dbId ?? null,
    subject,
    rows: rows.length,
    sha256: contentHash(columns, rows),
    integrity,
    validated,
    round,
  };
}
