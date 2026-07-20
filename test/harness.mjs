// 골든 하네스 — §7 의 대조 규율을 코드로 옮긴 것.
//
//   golden/<case>/input.*  + manifest.json + case.json
//     → expected/model.json + expected/report.json
//
// 대조물은 정규 모델의 **구조**와 Report 의 **기계 필드**뿐이다.
// 제외: provenance 의 비결정 필드(sha256·executed_at·subject)와 report.message(부록 A-7).

import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ingest } from "../src/index.js";
import { canonJsonPretty } from "../src/canon.js";

const NONDETERMINISTIC = ["sha256", "executed_at", "subject"];
export const GOLDEN_DIR = new URL("../golden/", import.meta.url).pathname;

export function listCases() {
  return readdirSync(GOLDEN_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** 골든 케이스 하나를 실행한다. 입력 파일 확장자가 곧 전달 방식이다(.bin 이면 raw bytes). */
export function runCase(name) {
  const dir = join(GOLDEN_DIR, name);
  const inputFile = readdirSync(dir).find((f) => f.startsWith("input."));
  if (!inputFile) throw new Error(`${name}: input.* 파일이 없다`);
  const raw = readFileSync(join(dir, inputFile));
  const input = inputFile.endsWith(".bin")
    ? new Uint8Array(raw)
    : raw.toString("utf8");

  const manifest = readJsonIf(join(dir, "manifest.json"));
  const spec = readJsonIf(join(dir, "case.json")) ?? {};
  // base 는 다른 케이스의 산출물을 재사용한다 — round-2 가 실제로 1라운드 위에 쌓이는지 보려는 것.
  const base = spec.base ? runCase(spec.base).model : undefined;

  const { model, report } = ingest(
    input,
    manifest,
    spec.params ?? {},
    spec.opts ?? {},
    base,
  );
  return { model, report };
}

/** 비결정 필드를 도려낸 비교용 모델. */
export function structural(model) {
  if (!model) return null;
  const queries = {};
  for (const [id, q] of Object.entries(model.queries)) {
    const provenance = { ...q.provenance };
    for (const k of NONDETERMINISTIC) delete provenance[k];
    queries[id] = { columns: q.columns, rows: q.rows, provenance };
  }
  return { queries };
}

/** message 를 뺀 비교용 Report. code 만 계약이다. */
export function machineReport(report) {
  const strip = ({ code, query_id, where }) => {
    const o = { code };
    if (query_id) o.query_id = query_id;
    if (where) o.where = where;
    return o;
  };
  const out = strip(report);
  if (report.warnings) out.warnings = report.warnings.map(strip);
  return out;
}

export function expectedOf(name) {
  const dir = join(GOLDEN_DIR, name, "expected");
  return {
    model: readJsonIf(join(dir, "model.json")),
    report: readJsonIf(join(dir, "report.json")),
  };
}

export function writeExpected(name, model, report) {
  const dir = join(GOLDEN_DIR, name, "expected");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "model.json"), canonJsonPretty(structural(model)));
  writeFileSync(
    join(dir, "report.json"),
    canonJsonPretty(machineReport(report)),
  );
}

function readJsonIf(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}
