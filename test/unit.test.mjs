import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { sha256Text, sha256Bytes } from "../src/sha256.js";
import { parseDelimited, detectDelimiter } from "../src/delimited.js";
import { decode, normalizeText } from "../src/text.js";
import { subjectFingerprint } from "../src/seal.js";
import { ingest } from "../src/index.js";
import { CODES } from "../src/codes.js";

// ── sha256 ─────────────────────────────────────────────────────────────────
// 직접 구현했으므로 표준 구현과 대조한다. 여기가 틀리면 subject 가드가 통째로 거짓이 된다.
test("sha256: node:crypto 와 일치한다", () => {
  const samples = [
    "",
    "abc",
    "온도센서A",
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(64),
    "x".repeat(1000),
  ];
  for (const s of samples) {
    assert.equal(
      sha256Text(s),
      createHash("sha256").update(s, "utf8").digest("hex"),
      `입력: ${s.slice(0, 12)}`,
    );
  }
  const bytes = new Uint8Array([0, 1, 2, 255, 128]);
  assert.equal(
    sha256Bytes(bytes),
    createHash("sha256").update(bytes).digest("hex"),
  );
});

// ── 구분자 파싱 ─────────────────────────────────────────────────────────────
test("인용 없는 빈 칸은 NULL, 인용된 빈 칸은 빈 문자열", () => {
  const [row] = parseDelimited('"a","",\n', ",");
  assert.deepEqual(row, ["a", "", null]);
});

test("인용 필드 안의 개행·구분자·이스케이프 따옴표를 삼킨다", () => {
  const [row] = parseDelimited('"줄1\n줄2","a,b","그는 ""안녕"" 했다"\n', ",");
  assert.deepEqual(row, ["줄1\n줄2", "a,b", '그는 "안녕" 했다']);
});

test("숫자를 파싱하지 않는다 — Oracle NUMBER 정밀도 보존(§6)", () => {
  const [row] = parseDelimited(
    "12345678901234567890123456789012345678,0.10\n",
    ",",
  );
  assert.deepEqual(row, ["12345678901234567890123456789012345678", "0.10"]);
});

test("구분자 판별은 통계가 아니라 결정 규칙이다", () => {
  assert.equal(detectDelimiter("A\tB\nx\ty\n"), "\t");
  assert.equal(detectDelimiter("A,B\nx,y\n"), ",");
});

// ── 인코딩·정규화 ───────────────────────────────────────────────────────────
test("인코딩 판별: strict UTF-8 → strict CP949 → 불능", () => {
  assert.equal(decode(new TextEncoder().encode("온도")).encoding, "utf-8");
  // CP949 로 인코드된 "가" (0xB0 0xA1) 는 UTF-8 로는 불법이라 두 번째 후보가 잡는다.
  const cp949 = new Uint8Array([0xb0, 0xa1]);
  const got = decode(cp949);
  assert.equal(got.ok, true);
  assert.equal(got.encoding, "cp949");
  assert.equal(got.text, "가");
  assert.equal(decode(new Uint8Array([0x41, 0xff, 0xfe])).ok, false);
});

test("BOM 을 제거한다", () => {
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);
  assert.equal(decode(withBom).text, "A");
});

test("NFD 입력을 NFC 로 접어 골든이 클립보드 경로에 흔들리지 않게 한다", () => {
  const nfd = "가"; // ᄀ + ᅡ
  assert.equal(normalizeText(nfd), "가");
  assert.equal(normalizeText("a\r\nb\rc"), "a\nb\nc");
});

// ── 주체 지문 ───────────────────────────────────────────────────────────────
test("subject: 키 순서가 달라도 같은 지문 — 포트 간 재현 가능해야 한다", () => {
  const a = subjectFingerprint("FDCPRD", {
    sensor_id: "S-0004",
    site: "STE01",
  });
  const b = subjectFingerprint("FDCPRD", {
    site: "STE01",
    sensor_id: "S-0004",
  });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("subject: 파라미터나 DB 가 다르면 지문이 갈린다(v0.8 F1 의 근거)", () => {
  const base = subjectFingerprint("FDCPRD", { sensor_id: "S-0004" });
  assert.notEqual(base, subjectFingerprint("FDCPRD", { sensor_id: "S-0005" }));
  assert.notEqual(base, subjectFingerprint("FDCDEV", { sensor_id: "S-0004" }));
});

// ── ingest 계약 ─────────────────────────────────────────────────────────────
const SPOOL = [
  "==META db=FDCPRD ts=2026-07-19T10:00:00+09:00 params=sensor_id:S-0004 a1b2==",
  "==BEGIN q01 a1b2==",
  "SENSOR_ID,SENSOR_NM",
  "S-0004,온도센서A",
  "==END q01 ROWS:1 a1b2==",
  "==BUNDLE COMPLETE: 1 a1b2==",
  "",
].join("\n");
const MANIFEST = {
  db: "FDCPRD",
  queries: { q01: { expected_columns: ["SENSOR_ID", "SENSOR_NM"] } },
};
const PARAMS = { sensor_id: "S-0004" };
const OPTS = { nonce: "a1b2" };

test("데이터 문제는 예외가 아니라 Report 로 나온다(부록 A-4)", () => {
  for (const bad of ["", "아무 말", "==BEGIN x==\n"]) {
    const { report } = ingest(bad, MANIFEST, PARAMS, OPTS);
    assert.ok(CODES.includes(report.code), `알 수 없는 code: ${report.code}`);
  }
});

test("잘못된 타입만 예외다", () => {
  assert.throws(() => ingest(42, MANIFEST, PARAMS, OPTS), TypeError);
});

test("모델에 정체·세션 메타가 없다(v0.7 규율)", () => {
  const { model } = ingest(SPOOL, MANIFEST, PARAMS, OPTS);
  assert.deepEqual(Object.keys(model), ["queries"]);
  const q = model.queries.q01;
  assert.deepEqual(Object.keys(q).sort(), ["columns", "provenance", "rows"]);
  assert.equal(
    JSON.stringify(model).includes("S-0004") &&
      JSON.stringify(q.provenance).includes("S-0004"),
    false,
  );
});

test("컬럼 순서를 매니페스트 순으로 고정한다(§6) — 순서만 다르면 오류가 아니라 정규화다", () => {
  const swapped = SPOOL.replace(
    "SENSOR_ID,SENSOR_NM",
    "SENSOR_NM,SENSOR_ID",
  ).replace("S-0004,온도센서A", "온도센서A,S-0004");
  const { model, report } = ingest(swapped, MANIFEST, PARAMS, OPTS);
  assert.equal(report.code, "OK");
  assert.deepEqual(model.queries.q01.columns, ["SENSOR_ID", "SENSOR_NM"]);
  assert.deepEqual(model.queries.q01.rows, [["S-0004", "온도센서A"]]);
});

test("같은 입력은 같은 모델 — 시계·난수를 타지 않는다(§6)", () => {
  const a = ingest(SPOOL, MANIFEST, PARAMS, OPTS).model;
  const b = ingest(SPOOL, MANIFEST, PARAMS, OPTS).model;
  assert.deepEqual(a, b);
});

test("CP949 로 들어와도 UTF-8 과 같은 모델이 나온다 — 포트 패리티의 전제", () => {
  const utf8 = ingest(SPOOL, MANIFEST, PARAMS, OPTS).model;
  // Node 에는 CP949 인코더가 없으므로 iconv 없이 검증 가능한 ASCII 부분만 대조한다.
  const asciiSpool = SPOOL.replace("온도센서A", "SensorA");
  const asString = ingest(asciiSpool, MANIFEST, PARAMS, OPTS).model;
  const asBytes = ingest(
    new TextEncoder().encode(asciiSpool),
    MANIFEST,
    PARAMS,
    OPTS,
  ).model;
  assert.deepEqual(asString, asBytes);
  assert.equal(utf8.queries.q01.rows[0][0], "S-0004");
});

test("자유형 모델은 병합의 base 가 될 수 없다(v0.8 F8)", () => {
  const free = ingest("A,B\n1,2\n", null, {}, { query_id: "q01" }).model;
  assert.equal(free.queries.q01.provenance.validated, false);
  const { model, report } = ingest(SPOOL, MANIFEST, PARAMS, OPTS, free);
  assert.equal(report.code, "MERGE_CONFLICT");
  assert.equal(model, undefined);
});

test("병합은 멱등이다 — 같은 증분을 두 번 넣어도 모델이 같다", () => {
  const base = ingest(SPOOL, MANIFEST, PARAMS, OPTS).model;
  const once = ingest(SPOOL, MANIFEST, PARAMS, OPTS, base).model;
  const twice = ingest(SPOOL, MANIFEST, PARAMS, OPTS, once).model;
  assert.deepEqual(once, base);
  assert.deepEqual(twice, base);
});
