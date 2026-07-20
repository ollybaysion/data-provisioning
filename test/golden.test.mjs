import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listCases,
  runCase,
  structural,
  machineReport,
  expectedOf,
} from "./harness.mjs";
import { canonJson } from "../src/canon.js";

// 골든은 계약 준수의 판정 기준이다(§7). 타 언어 포트는 같은 golden/ 을 통과할 의무를 진다.
for (const name of listCases()) {
  test(`골든: ${name}`, () => {
    const { model, report } = runCase(name);
    const want = expectedOf(name);
    assert.ok(want.report, `${name}: expected/report.json 이 없다`);
    assert.equal(
      canonJson(machineReport(report)),
      canonJson(want.report),
      "Report 기계 필드",
    );
    assert.equal(
      canonJson(structural(model)),
      canonJson(want.model),
      "정규 모델 구조",
    );
  });
}

test("골든이 최소셋을 덮는다(§11-2)", () => {
  const cases = listCases();
  for (const required of [
    "marker-basic", // 마커 스풀
    "grid-csv", // 그리드/CSV
    "fail-truncated", // 잘림
    "fail-rowcount", // 행 유실
    "fail-column", // 컬럼 불일치
    "fail-identity", // META 불일치
  ]) {
    assert.ok(cases.includes(required), `최소셋 누락: ${required}`);
  }
});
