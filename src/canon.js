// 캐노니컬 폼 — 키 정렬 직렬화(RFC 8785 계열).
//
// 주의: 이건 **판정 단위가 아니다**(§6). 판정은 정규 모델의 구조 비교이고, 이 직렬화는
// 골든 파일을 사람이 읽고 diff 하기 좋게 저장하려는 편의 + sha256 preimage 를 고정하려는 용도다.

export function canonJson(value) {
  return JSON.stringify(sortKeys(value));
}

export function canonJsonPretty(value) {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    // 코드포인트 순 — 로케일 콜레이션을 쓰면 구현마다 갈린다(§6).
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}
