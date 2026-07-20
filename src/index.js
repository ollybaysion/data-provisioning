// 엔진의 공개 표면 — 함수 하나(ingest)와 계약 하나(render)(§3).
//
// render 는 구현이 소비자 몫이라 여기서 내보낼 실체가 없다. 엔진이 소유하는 것은 인터페이스와
// 표현별 스키마 계약뿐이며, 레퍼런스 렌더러(sqlite-bundle·text)는 렌더러 착수 시 renderers/ 로 들어온다.

export { ingest } from "./ingest.js";
export { CODES, FATAL, isFatal } from "./codes.js";
export { canonJson, canonJsonPretty } from "./canon.js";
export { subjectFingerprint } from "./seal.js";
