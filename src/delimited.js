// ③ 파싱(parse-rows) — Oracle CSV 방언과 그리드 복사(TSV).
//
// 핵심 규칙 두 가지(§6·전송 표준 §4.2):
//  - 값은 원문 문자열 그대로. 숫자 파싱을 하지 않는다(Oracle NUMBER 38자리가 double 왕복에서 훼손된다).
//  - 인용 없는 빈 칸 = NULL(null), 인용된 빈 칸("") = 빈 문자열. `QUOTE ON` 강제 인용이 이걸 가능하게 한다.

/**
 * 구분자 텍스트를 레코드 배열로. 인용 필드 안의 개행·구분자를 올바로 삼킨다.
 * @param {string} text
 * @param {string} delim
 * @returns {(string|null)[][]}
 */
export function parseDelimited(text, delim) {
  const records = [];
  let rec = [];
  let field = "";
  let quoted = false; // 지금 인용 안에 있는가
  let wasQuoted = false; // 이 필드가 인용으로 시작했는가 (NULL 과 빈 문자열을 가르는 근거)
  let started = false; // 이 레코드에 내용이 하나라도 있었는가

  const endField = () => {
    rec.push(wasQuoted ? field : field === "" ? null : field);
    field = "";
    wasQuoted = false;
  };
  const endRecord = () => {
    endField();
    records.push(rec);
    rec = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "" && !wasQuoted) {
      quoted = true;
      wasQuoted = true;
      started = true;
      continue;
    }
    if (c === delim) {
      endField();
      started = true;
      continue;
    }
    if (c === "\n") {
      if (started || field !== "") endRecord();
      continue; // 빈 줄은 레코드로 세지 않는다
    }
    field += c;
    started = true;
  }
  if (started || field !== "") endRecord();
  return records;
}

/**
 * 구분자 판별. 통계가 아니라 결정 규칙이다(§6) — 첫 줄에 탭이 있으면 TSV, 아니면 CSV.
 * 그리드 복사는 탭 구분이고 SQL Developer 내보내기는 쉼표라 이 한 줄로 갈린다.
 */
export function detectDelimiter(text) {
  const firstLine = text.split("\n", 1)[0] ?? "";
  return firstLine.includes("\t") ? "\t" : ",";
}
