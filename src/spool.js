// ①형식 감지 + ② 분할(split) — 마커 스풀 문법 v2(전송 표준 §4.2 가 정본).
//
//   spool   := meta_header block* trailer
//   meta    := "==META db=" db " ts=" iso8601 " params=" k_v " " nonce "==" NL
//   block   := "==BEGIN " query_id " " nonce "==" NL csv_lines
//              "==END " query_id " ROWS:" n " " nonce "==" NL
//   trailer := "==BUNDLE COMPLETE: " count " " nonce "==" NL

import { escapeRe } from "./text.js";

// 마커를 "흉내낸" 줄. 논스가 안 맞으면 데이터로 취급하지만, 유효 마커가 하나도 없으면
// 부분 마킹(PARTIAL_MARKING)으로 하드 실패시키는 근거가 된다(v0.8 F3).
const MARKERISH = /^==(META |BEGIN |END |BUNDLE COMPLETE:).*==$/;

function patterns(nonce) {
  const n = escapeRe(nonce);
  return {
    meta: new RegExp(`^==META db=(\\S+) ts=(\\S+) params=(\\S*) ${n}==$`),
    begin: new RegExp(`^==BEGIN (\\S+) ${n}==$`),
    end: new RegExp(`^==END (\\S+) ROWS:(\\d+) ${n}==$`),
    trailer: new RegExp(`^==BUNDLE COMPLETE: (\\d+) ${n}==$`),
  };
}

/** `sensor_id:S-0004,site:STE01` → { sensor_id: 'S-0004', site: 'STE01' } */
export function parseMetaParams(s) {
  const out = {};
  if (!s) return out;
  for (const pair of s.split(",")) {
    if (!pair) continue;
    const idx = pair.indexOf(":");
    if (idx === -1) out[pair] = "";
    else out[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return out;
}

/**
 * 입력이 마커 스풀인지, 무결성 봉투가 없는 그리드/CSV인지 가른다.
 * 논스가 없으면 유효 마커를 인정할 수 없으므로, 마커처럼 생긴 줄이 있는 입력은
 * 조용히 CSV 로 폴백하지 않고 부분 마킹으로 실패한다(§9).
 *
 * @returns {{ kind: 'spool' } | { kind: 'delimited' } | { kind: 'partial', reason: string }}
 */
export function classify(text, nonce) {
  const lines = text.split("\n");
  const markerish = lines.filter((l) => MARKERISH.test(l));
  if (markerish.length === 0) return { kind: "delimited" };
  if (!nonce) {
    return {
      kind: "partial",
      reason:
        "마커가 있는 입력인데 opts.nonce 가 없어 유효 마커를 인정할 수 없다",
    };
  }
  const p = patterns(nonce);
  const valid = lines.some(
    (l) =>
      p.meta.test(l) || p.begin.test(l) || p.end.test(l) || p.trailer.test(l),
  );
  if (!valid) {
    return {
      kind: "partial",
      reason:
        "마커처럼 생긴 줄은 있으나 논스가 일치하는 유효 마커가 하나도 없다",
    };
  }
  return { kind: "spool" };
}

/**
 * 마커 스풀을 META·블록·트레일러로 절단한다.
 * 논스가 박힌 줄만 마커로 인정하므로, 컬럼 값에 `==END ...==` 가 들어 있어도 분할이 오염되지 않는다.
 * 그런 위조 시도는 데이터로 남아 블록의 ROWS 대조에서 걸린다.
 *
 * @returns {{ ok: true, meta, blocks } | { ok: false, finding }}
 */
export function splitSpool(text, nonce) {
  const p = patterns(nonce);
  const lines = text.split("\n");

  let meta = null;
  let trailerCount = null;
  const blocks = [];
  let open = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const at = `line ${i + 1}`;

    if (open) {
      const endM = p.end.exec(line);
      if (endM) {
        if (endM[1] !== open.id) {
          return fail(
            "TRUNCATED_PASTE",
            `블록 ${open.id} 이 닫히기 전에 다른 END(${endM[1]})가 나왔다`,
            open.id,
            at,
          );
        }
        blocks.push({
          id: open.id,
          body: open.body.join("\n"),
          declaredRows: Number(endM[2]),
          at: open.at,
        });
        open = null;
        continue;
      }
      if (p.begin.test(line)) {
        return fail(
          "TRUNCATED_PASTE",
          `블록 ${open.id} 의 END 마커가 없이 다음 BEGIN 이 나왔다`,
          open.id,
          at,
        );
      }
      open.body.push(line);
      continue;
    }

    const beginM = p.begin.exec(line);
    if (beginM) {
      open = { id: beginM[1], body: [], at };
      continue;
    }
    const metaM = p.meta.exec(line);
    if (metaM) {
      if (!meta)
        meta = {
          db: metaM[1],
          ts: metaM[2],
          params: parseMetaParams(metaM[3]),
        };
      continue;
    }
    const trailerM = p.trailer.exec(line);
    if (trailerM) {
      trailerCount = Number(trailerM[1]);
      continue;
    }
    // 그 밖의 줄(SQL*Plus 잡음·빈 줄)은 관대하게 무시한다.
  }

  if (open) {
    return fail(
      "TRUNCATED_PASTE",
      `블록 ${open.id} 의 END 마커 없이 입력이 끝났다`,
      open.id,
      open.at,
    );
  }
  if (!meta) {
    return fail(
      "TRUNCATED_PASTE",
      "META 헤더가 없다 — 통복사가 앞에서 잘렸다",
      undefined,
      "META",
    );
  }
  if (trailerCount === null) {
    return fail(
      "TRUNCATED_PASTE",
      "BUNDLE COMPLETE 트레일러가 없다 — 통복사가 뒤에서 잘렸다",
      undefined,
      "trailer",
    );
  }
  if (trailerCount !== blocks.length) {
    return fail(
      "TRUNCATED_PASTE",
      `트레일러는 ${trailerCount}개 블록을 선언했는데 ${blocks.length}개만 있다`,
      undefined,
      "trailer",
    );
  }
  return { ok: true, meta, blocks };
}

function fail(code, message, query_id, where) {
  const finding = { code, message };
  if (query_id) finding.query_id = query_id;
  if (where) finding.where = where;
  return { ok: false, finding };
}
