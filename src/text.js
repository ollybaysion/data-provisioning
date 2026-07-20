// ① 감지(detect) 중 인코딩·개행·정규화 부분. 설계 §6 의 결정 규율을 그대로 옮긴 것이다.

/**
 * 결정 알고리즘: strict UTF-8 → strict CP949 → 실패.
 * 통계 기반 감지는 금지다 — 구현마다 판정이 갈려 포트 패리티가 깨진다(§6).
 *
 * TextDecoder 는 Node 전용이 아니라 WHATWG 웹 표준이라 브라우저 번들 요구(§1.2)를 지킨다.
 * "euc-kr" 라벨은 인코딩 표준상 실제로는 CP949(UHC) 테이블이라 한글 확장 영역까지 덮는다.
 *
 * @returns {{ ok: true, text: string, encoding: 'utf-8'|'cp949' } | { ok: false }}
 */
export function decode(input, forced) {
  if (typeof input === "string") {
    // 이미 디코드된 문자열 — 호스트가 인코딩을 이미 해결했다는 뜻이라 그대로 받는다.
    return { ok: true, text: input, encoding: forced ?? "utf-8" };
  }
  let bytes = input;
  // BOM 제거(§전송 표준 §4.2 공통 규칙)
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    bytes = bytes.subarray(3);
  }
  const order = forced ? [forced] : ["utf-8", "cp949"];
  for (const enc of order) {
    const label = enc === "cp949" ? "euc-kr" : "utf-8";
    try {
      return {
        ok: true,
        text: new TextDecoder(label, { fatal: true }).decode(bytes),
        encoding: enc,
      };
    } catch {
      /* 다음 후보로 */
    }
  }
  return { ok: false };
}

/**
 * 개행 통일(CRLF|CR → LF)과 유니코드 NFC 정규화(§6).
 * NFC 를 거는 이유: 한글 NFC `가` 와 NFD `ᄀ+ᅡ` 는 사람 눈에 같은데 코드포인트가 달라,
 * macOS 클립보드(NFD)를 거친 입력이 골든·해시·동치 비교를 조용히 깨뜨린다.
 */
export function normalizeText(text) {
  return text.replace(/\r\n?/g, "\n").normalize("NFC");
}

/** 정규식 메타문자를 죽인다 — 논스는 외부 입력이라 그대로 패턴에 넣으면 안 된다. */
export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
