#!/usr/bin/env node
// CLI 포트 — 첫 포트인 이유는 호스트 의존이 0이라 표면 순수성을 가장 싸게 검증하기 때문이다(§11).
// 파일을 읽어 바이트로 넘기는 일(포트 책임 §8-1)과 결과를 쓰는 일만 하고, 해석은 전부 엔진이 한다.

import { readFileSync, writeFileSync } from "node:fs";
import { ingest, canonJsonPretty } from "../src/index.js";

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  console.log(`dp — data-provisioning 엔진 CLI

  dp ingest <input> [옵션]

옵션:
  --manifest <file>   검증용 매니페스트 JSON (없으면 자유형 모드)
  --params k=v,...    조회 주체 파라미터. META 에코와 대조한다
  --nonce <token>     마커 스풀 검증용 논스. 마커가 있는 입력에는 필수
  --encoding <enc>    utf-8 | cp949 로 강제 (기본은 결정 알고리즘)
  --query-id <id>     그리드/CSV 입력의 쿼리 id
  --base <file>       기존 모델 JSON. 주면 round-2 증분으로 병합한다
  --out <file>        모델을 쓸 경로 (기본 stdout)

종료 코드: 0 = 정상·경고, 1 = 치명(모델 없음), 2 = 사용법 오류`);
  process.exit(0);
}

if (argv[0] !== "ingest") {
  console.error(`알 수 없는 명령: ${argv[0]}`);
  process.exit(2);
}

const opt = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

const inputPath = argv[1];
if (!inputPath || inputPath.startsWith("--")) {
  console.error("입력 파일 경로가 필요하다");
  process.exit(2);
}

const params = Object.fromEntries(
  (opt("--params") ?? "")
    .split(",")
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=");
      return i === -1 ? [p, ""] : [p.slice(0, i), p.slice(i + 1)];
    }),
);

const opts = {};
if (opt("--nonce")) opts.nonce = opt("--nonce");
if (opt("--encoding")) opts.encoding = opt("--encoding");
if (opt("--query-id")) opts.query_id = opt("--query-id");

const manifestPath = opt("--manifest");
const basePath = opt("--base");

const { model, report } = ingest(
  new Uint8Array(readFileSync(inputPath)),
  manifestPath ? JSON.parse(readFileSync(manifestPath, "utf8")) : null,
  params,
  opts,
  basePath ? JSON.parse(readFileSync(basePath, "utf8")) : undefined,
);

const line = (f) =>
  `${f.code}${f.query_id ? ` [${f.query_id}]` : ""}${f.where ? ` (${f.where})` : ""}: ${f.message}`;
console.error(line(report));
for (const w of report.warnings ?? []) console.error(`  · ${line(w)}`);

if (!model) process.exit(1);

const out = canonJsonPretty(model);
const outPath = opt("--out");
if (outPath) {
  writeFileSync(outPath, out);
  console.error(`모델 → ${outPath}`);
} else {
  process.stdout.write(out);
}
