// ingest — 엔진의 유일한 함수. "bytes in → model out"(§1·§3).
//
// 내부 6단계: ① 감지 → ② 분할 → ③ 파싱 → ④ 검증 → ⑤ 정규화 → ⑥ 봉인.
// 포트는 이 단계들을 알지 못한다. 예외는 프로그래밍 오류(잘못된 타입)뿐이고,
// 데이터 문제는 전부 Report 로 나간다(부록 A-4).

import { decode, normalizeText } from "./text.js";
import { classify, splitSpool } from "./spool.js";
import { parseDelimited, detectDelimiter } from "./delimited.js";
import { subjectFingerprint, makeProvenance } from "./seal.js";
import { mergeModels, maxRound } from "./merge.js";
import { toReport, isFatal } from "./codes.js";

/**
 * @param {Uint8Array|string} input   스풀 패키지 bytes 또는 이미 디코드된 문자열
 * @param {object|null} manifest      검증용 입력 — 출력 모델에 에코하지 않는다
 * @param {object} params             검증용 입력 — subject 해시의 preimage 로만 남는다
 * @param {object} [opts]             { nonce, encoding?, query_id? } — 비결정 값의 호스트 주입 통로
 * @param {object} [base]             있으면 query-id 합집합으로 병합(round-2)
 * @returns {{ model?: object, report: object }}
 */
export function ingest(
  input,
  manifest = null,
  params = {},
  opts = {},
  base = undefined,
) {
  if (typeof input !== "string" && !(input instanceof Uint8Array)) {
    throw new TypeError("ingest: input 은 Uint8Array 또는 string 이어야 한다");
  }
  const findings = [];
  const done = (model) => {
    const report = toReport(findings);
    return isFatal(report.code) ? { report } : { model, report };
  };
  const bail = (finding) => ({ report: toReport([...findings, finding]) });

  // ── ① 감지 ──────────────────────────────────────────────────────────────
  const decoded = decode(input, opts.encoding);
  if (!decoded.ok) {
    return bail({
      code: "ENCODING_UNDECIDABLE",
      message:
        "strict UTF-8 도 strict CP949 도 아니다 — 통계 감지는 하지 않는다",
    });
  }
  const text = normalizeText(decoded.text);
  const shape = classify(text, opts.nonce);
  if (shape.kind === "partial") {
    return bail({ code: "PARTIAL_MARKING", message: shape.reason });
  }

  // ── ②③ 분할·파싱 ────────────────────────────────────────────────────────
  const parsed =
    shape.kind === "spool"
      ? readSpool(text, opts.nonce)
      : readDelimited(text, manifest, opts);
  if (!parsed.ok) return bail(parsed.finding);

  const { meta, integrity, blocks } = parsed;
  if (integrity === "none") {
    findings.push({
      code: "INTEGRITY_ABSENT",
      message:
        "무결성 봉투가 없는 입력이다 — 논스·META·ROWS·트레일러 중 검사한 것이 없다",
    });
  }

  // ── ④ 검증 ──────────────────────────────────────────────────────────────
  if (meta) {
    const idMismatch = checkIdentity(meta, manifest, params);
    if (idMismatch) return bail(idMismatch);
  }

  // ── ⑤⑥ 정규화·봉인 ──────────────────────────────────────────────────────
  const subject = subjectFingerprint(meta?.db ?? null, params);
  const round = base ? maxRound(base) + 1 : 1;
  const queries = {};

  for (const block of blocks) {
    const spec = manifest?.queries?.[block.id];
    let { columns, rows } = block;

    if (spec) {
      const aligned = alignColumns(columns, rows, spec.expected_columns);
      if (!aligned.ok) {
        return bail({
          code: "COLUMN_MISMATCH",
          message: aligned.message,
          query_id: block.id,
          where: block.at,
        });
      }
      columns = aligned.columns;
      rows = aligned.rows;
    }

    if (
      block.declaredRows !== undefined &&
      block.declaredRows !== rows.length
    ) {
      return bail({
        code: "ROWCOUNT_MISMATCH",
        message: `블록이 ${block.declaredRows}행을 선언했는데 ${rows.length}행만 파싱됐다 — 블록 내부 행이 유실됐다`,
        query_id: block.id,
        where: block.at,
      });
    }
    if (rows.length === 0) {
      findings.push({
        code: "ZERO_ROWS",
        message: "결과가 0행이다",
        query_id: block.id,
      });
    }

    queries[block.id] = {
      columns,
      rows,
      provenance: makeProvenance({
        executedAt: meta?.ts ?? null,
        dbId: meta?.db ?? null,
        subject,
        rows,
        columns,
        integrity,
        validated: Boolean(spec) && integrity === "marker-nonce",
        round,
      }),
    };
  }

  let model = { queries };

  // ── round-2 병합 ────────────────────────────────────────────────────────
  if (base) {
    const merged = mergeModels(base, model);
    if (!merged.ok) return bail(merged.finding);
    model = merged.model;
    findings.push(...merged.findings);
  }

  return done(model);
}

// ─────────────────────────────────────────────────────────────────────────

function readSpool(text, nonce) {
  const split = splitSpool(text, nonce);
  if (!split.ok) return split;
  const blocks = [];
  for (const b of split.blocks) {
    const records = parseDelimited(b.body, ",");
    const [header, ...rows] = records;
    blocks.push({
      id: b.id,
      columns: (header ?? []).map((c) => c ?? ""),
      rows,
      declaredRows: b.declaredRows,
      at: b.at,
    });
  }
  return { ok: true, meta: split.meta, integrity: "marker-nonce", blocks };
}

function readDelimited(text, manifest, opts) {
  const records = parseDelimited(text, detectDelimiter(text));
  if (records.length === 0) {
    return { ok: true, meta: null, integrity: "none", blocks: [] };
  }
  // 쿼리 id 의 공급 경로가 입력에 없다 — opts → 매니페스트가 단일 쿼리면 그 id → 기본값 순.
  const manifestIds = Object.keys(manifest?.queries ?? {});
  const id =
    opts.query_id ?? (manifestIds.length === 1 ? manifestIds[0] : "q01");

  const expected = manifest?.queries?.[id]?.expected_columns;
  const first = records[0].map((c) => c ?? "");
  // 헤더 유무 불문(표준 §4.4). 기대 컬럼과 집합이 같으면 헤더, 아니면 데이터로 본다.
  const firstIsHeader = expected ? sameSet(first, expected) : true;
  const columns = firstIsHeader ? first : expected;
  const rows = firstIsHeader ? records.slice(1) : records;

  return {
    ok: true,
    meta: null,
    integrity: "none",
    blocks: [{ id, columns, rows, at: "line 1" }],
  };
}

function checkIdentity(meta, manifest, params) {
  if (manifest?.db && meta.db !== manifest.db) {
    return {
      code: "IDENTITY_MISMATCH",
      message: `매니페스트는 DB ${manifest.db} 를 기대하는데 스풀은 ${meta.db} 에서 나왔다`,
      where: "META db",
    };
  }
  const want = Object.entries(params ?? {}).map(([k, v]) => [
    k,
    v === null || v === undefined ? "" : String(v),
  ]);
  const got = meta.params;
  const wantKeys = want.map(([k]) => k).sort();
  const gotKeys = Object.keys(got).sort();
  if (wantKeys.join(",") !== gotKeys.join(",")) {
    return {
      code: "IDENTITY_MISMATCH",
      message: `요청 파라미터(${wantKeys.join(",") || "없음"})와 META 에코(${gotKeys.join(",") || "없음"})의 키가 다르다`,
      where: "META params",
    };
  }
  for (const [k, v] of want) {
    if (got[k] !== v) {
      return {
        code: "IDENTITY_MISMATCH",
        message: `파라미터 ${k} 가 요청은 ${v} 인데 스풀은 ${got[k]} 로 실행됐다`,
        where: "META params",
      };
    }
  }
  return null;
}

/**
 * ⑤ 정규화 — 컬럼 순서를 매니페스트 expected_columns 순으로 고정한다(§6).
 * 집합이 같고 순서만 다르면 재배열이고(정규화), 집합 자체가 다르면 COLUMN_MISMATCH 다.
 */
function alignColumns(columns, rows, expected) {
  if (!sameSet(columns, expected)) {
    const missing = expected.filter((c) => !columns.includes(c));
    const extra = columns.filter((c) => !expected.includes(c));
    return {
      ok: false,
      message: `컬럼이 기대와 다르다 — 누락 [${missing.join(", ")}] / 초과 [${extra.join(", ")}]`,
    };
  }
  const order = expected.map((c) => columns.indexOf(c));
  return {
    ok: true,
    columns: [...expected],
    rows: rows.map((r) => order.map((i) => r[i] ?? null)),
  };
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
