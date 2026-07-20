// round-2 증분 병합 — 별도 함수가 아니라 `ingest` 의 `base` 인자로만 들어온다(§3).
//
// 세 가드(v0.8 F1·F7·F8):
//  (a) base 와 delta 의 주체 지문이 다르면 IDENTITY_MISMATCH — 이게 병합 안전의 전부다.
//      §10-6 의 "같은 id 충돌" 가드는 재조달 delta 가 base 와 **disjoint id** 라서 구조적으로 못 뜬다.
//  (b) 자유형(validated:false) 모델은 base 가 될 수 없다 — 검증 안 된 데이터가 검증된 모델을 오염시킨다.
//  (c) 스테일은 가장 오래된 executed_at 이 지배하고, 시각이 섞이면 TIME_MIXED 로 알린다.

import { canonJson } from "./canon.js";

export function maxRound(model) {
  let max = 0;
  for (const q of Object.values(model.queries))
    max = Math.max(max, q.provenance.round);
  return max;
}

/**
 * @returns {{ ok: true, model, findings } | { ok: false, finding }}
 */
export function mergeModels(base, delta) {
  // (b) 자유형 base 금지
  const unvalidated = Object.entries(base.queries).find(
    ([, q]) => q.provenance.validated === false,
  );
  if (unvalidated) {
    return {
      ok: false,
      finding: {
        code: "MERGE_CONFLICT",
        message: "자유형(validated:false) 모델은 병합의 base 가 될 수 없다",
        query_id: unvalidated[0],
      },
    };
  }

  // (a) 주체 지문 일치
  const deltaSubjects = new Set(
    Object.values(delta.queries).map((q) => q.provenance.subject),
  );
  for (const [id, q] of Object.entries(base.queries)) {
    if (deltaSubjects.size > 0 && !deltaSubjects.has(q.provenance.subject)) {
      return {
        ok: false,
        finding: {
          code: "IDENTITY_MISMATCH",
          message:
            "base 와 증분의 주체 지문이 다르다 — 다른 대상·다른 DB 의 스풀을 병합하려 한다",
          query_id: id,
        },
      };
    }
  }

  const findings = [];
  const merged = { queries: { ...base.queries } };

  for (const [id, q] of Object.entries(delta.queries)) {
    const prior = merged.queries[id];
    if (!prior) {
      merged.queries[id] = q;
      continue;
    }
    // 같은 id 가 양쪽에 있다(§10-6). 내용이 같으면 멱등 재적용이라 base 를 그대로 둔다.
    const same =
      canonJson({ c: prior.columns, r: prior.rows }) ===
      canonJson({ c: q.columns, r: q.rows });
    if (same) continue;
    // 다르면 거부한다 — 조용한 덮어쓰기는 어느 쪽이 진실인지 호출자가 알 수 없게 만든다.
    return {
      ok: false,
      finding: {
        code: "MERGE_CONFLICT",
        message: `쿼리 ${id} 가 base 와 증분 양쪽에 있고 내용이 다르다`,
        query_id: id,
      },
    };
  }

  // (c) 시각 혼재
  const times = new Set(
    Object.values(merged.queries)
      .map((q) => q.provenance.executed_at)
      .filter((t) => t !== null),
  );
  if (times.size > 1) {
    findings.push({
      code: "TIME_MIXED",
      message: `병합 모델의 실행 시각이 ${times.size}종으로 섞였다 — 스테일 판정은 가장 오래된 값이 지배한다`,
    });
  }

  return { ok: true, model: merged, findings };
}
