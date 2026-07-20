import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// 스키마가 draft 2020-12 이므로 ajv 의 기본(draft-07) 진입점이 아니라 2020 빌드를 쓴다.
import Ajv from "ajv/dist/2020.js";

import { listCases, runCase } from "./harness.mjs";

// schemas/ 는 "형식 정본"이라고 설계 §5 가 선언한 파일들이다. 선언에 그치지 않게,
// 엔진의 실제 산출물이 그 스키마를 통과하는지 여기서 강제한다.
// (스키마와 구현이 갈라지면 포트가 스키마만 보고 만들었을 때 깨진다 — v0.8 F9 의 뿌리.)

const load = (name) =>
  JSON.parse(
    readFileSync(new URL(`../schemas/${name}`, import.meta.url), "utf8"),
  );
const ajv = new Ajv({ strict: false, allErrors: true });
const validateModel = ajv.compile(load("model.schema.json"));
const validateReport = ajv.compile(load("report.schema.json"));

const types = load("types.schema.json");
const typesAjv = new Ajv({ strict: false, allErrors: true });
typesAjv.addSchema(types, "types");
const validateManifest = typesAjv.compile({ $ref: "types#/$defs/Manifest" });
const validateOpts = typesAjv.compile({ $ref: "types#/$defs/IngestOpts" });

const fmt = (errors) =>
  (errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("; ");

for (const name of listCases()) {
  test(`스키마 준수: ${name}`, () => {
    const { model, report } = runCase(name);
    assert.ok(validateReport(report), `report: ${fmt(validateReport.errors)}`);
    if (model)
      assert.ok(validateModel(model), `model: ${fmt(validateModel.errors)}`);
  });
}

test("골든 매니페스트·opts 가 입력 계약을 지킨다", () => {
  for (const name of listCases()) {
    const dir = new URL(`../golden/${name}/`, import.meta.url);
    for (const [file, validate] of [
      ["manifest.json", validateManifest],
      ["case.json", null],
    ]) {
      let raw;
      try {
        raw = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
      } catch {
        continue; // 매니페스트가 없는 자유형 케이스
      }
      if (validate)
        assert.ok(validate(raw), `${name}/${file}: ${fmt(validate.errors)}`);
      else if (raw.opts)
        assert.ok(
          validateOpts(raw.opts),
          `${name}/opts: ${fmt(validateOpts.errors)}`,
        );
    }
  }
});

test("행 길이가 컬럼 수와 항상 같다", () => {
  for (const name of listCases()) {
    const { model } = runCase(name);
    if (!model) continue;
    for (const [id, q] of Object.entries(model.queries)) {
      for (const [i, row] of q.rows.entries()) {
        assert.equal(row.length, q.columns.length, `${name}/${id} 행 ${i}`);
      }
      assert.equal(
        q.provenance.rows,
        q.rows.length,
        `${name}/${id} provenance.rows`,
      );
    }
  }
});
