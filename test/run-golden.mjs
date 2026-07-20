#!/usr/bin/env node
// 골든 러너 — CI 겸용. `--update` 로 기대값을 재생성한다.
//
// 타 언어 포트(Spring 등)는 같은 golden/ 디렉토리를 통과할 의무를 진다(§7 포트 패리티).
// 그래서 기대값 파일은 언어 중립 JSON 이고, 이 러너는 그 JSON 을 읽는 한 구현일 뿐이다.

import {
  listCases,
  runCase,
  structural,
  machineReport,
  expectedOf,
  writeExpected,
} from "./harness.mjs";
import { canonJson } from "../src/canon.js";

const update = process.argv.includes("--update");
let failed = 0;

for (const name of listCases()) {
  const { model, report } = runCase(name);
  if (update) {
    writeExpected(name, model, report);
    console.log(`  ~ ${name} (기대값 갱신)`);
    continue;
  }
  const want = expectedOf(name);
  const gotModel = canonJson(structural(model));
  const gotReport = canonJson(machineReport(report));
  const wantModel = canonJson(want.model);
  const wantReport = canonJson(want.report);

  if (gotModel === wantModel && gotReport === wantReport) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
    if (gotReport !== wantReport)
      console.log(
        `      report 기대: ${wantReport}\n      report 실제: ${gotReport}`,
      );
    if (gotModel !== wantModel)
      console.log(
        `      model  기대: ${wantModel}\n      model  실제: ${gotModel}`,
      );
  }
}

if (!update) {
  console.log(failed === 0 ? "\n골든 전부 통과" : `\n골든 ${failed}건 실패`);
  process.exit(failed === 0 ? 0 : 1);
}
