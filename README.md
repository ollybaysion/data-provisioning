# data-provisioning

데이터가 **어떤 방식으로 제공돼도 해석해 받아들여** 정형 데이터로 바꾸는 순수 로직 코어.

한 줄 계약은 **"bytes in → model out"** 이다. 엔진은 파일을 열지도 저장하지도 않는다. 포트가
파일을 읽어 메모리 바이트로 건네면, 엔진은 해석·검증만 해서 **정규 모델(JSON)과 Report** 로
돌려준다. 그 뒤(어떤 형식으로 구울지, 어디 저장할지, 어떻게 조회할지)는 전부 포트의 몫이다.

설계 정본은 `data-provisioning-engine-design.md`(엔진), 그 상위가 `data-provisioning-design.md`
(데이터 공급 표준)다. 둘 다 이 레포 밖에 있고, 아래 본문의 §번호는 그 엔진 설계 문서를 가리킨다.
계약만 필요하다면 `schemas/` 3종과 `golden/`으로 충분하다 — 포트를 만드는 데 필요한 것은 그게
전부이며, 설계 문서는 "왜 그렇게 정했는가"를 담는다.

## 쓰기

```js
import { ingest } from "data-provisioning";

const { model, report } = ingest(bytes, manifest, { sensor_id: "S-0004" }, { nonce });
if (report.code !== "OK") showChips(report); // 포트는 code 로만 분기한다
```

`report.code` 는 안정 enum 이고 `report.message` 는 사람용·비계약이다. 치명 코드면 `model` 이
없다. 없는 쿼리를 나중에 채웠으면 기존 모델을 `base` 로 넘기면 병합된 모델이 돌아온다:

```js
const merged = ingest(deltaBytes, manifest, params, { nonce }, model);
```

별도의 merge 함수는 없다. 병합은 세 가드를 진다 — 주체 지문 불일치(`IDENTITY_MISMATCH`),
자유형 모델을 base 로 쓰기(`MERGE_CONFLICT`), 같은 쿼리 id 의 내용 충돌(`MERGE_CONFLICT`).

## CLI

호스트 의존이 0인 첫 포트이자 CI 골든 러너를 겸한다.

```sh
node bin/dp.mjs ingest <input> --manifest m.json --params sensor_id=S-0004 --nonce a1b2
node bin/dp.mjs ingest <delta> --manifest m.json --params sensor_id=S-0004 --nonce a1b2 --base model.json
```

종료 코드: `0` 정상·경고 / `1` 치명(모델 없음) / `2` 사용법 오류.

## 계약 파일

포트를 만드는 사람이 의존하는 것은 이 세 파일뿐이다.

| 파일 | 덮는 것 |
| --- | --- |
| `schemas/model.schema.json` | 출력 정본 — `queries` → `columns`/`rows`/`provenance` |
| `schemas/report.schema.json` | 실패 계약 — `code` 안정 enum |
| `schemas/types.schema.json` | 입력 계약 — `Manifest`(검증 서브셋)·`Params`·`IngestOpts` |

`test/schema.test.mjs` 가 엔진의 실제 산출물을 이 스키마들로 검증한다 — 스키마가 선언에
그치지 않고 구현과 함께 움직이게 하려는 것이다.

## 테스트

```sh
npm test          # 단위 + 골든 + 스키마 준수
npm run golden    # 골든만 (--update 로 기대값 재생성)
```

골든이 계약 준수의 판정 기준이다. 타 언어 포트(Spring 등)는 **같은 `golden/` 디렉토리를
통과할 의무**를 지며, 그게 포트 패리티의 증명 방식이다. 기대값 파일이 언어 중립 JSON 인 것도
그래서다 — `test/run-golden.mjs` 는 그 JSON 을 읽는 한 구현일 뿐이다.

대조물은 정규 모델의 **구조**와 Report 의 **기계 필드**뿐이다. 제외되는 것:

- `provenance.sha256`·`executed_at`·`subject` — 해시·시각이라 포트 간에 갈릴 수 있다
- `report.message` — 문구 차이로 전 포트가 동시에 깨지는 걸 막는다

## 규율

- **호스트 무관** — 파일시스템·네트워크·시계·난수에 접근하지 않는다. 시각·논스 등 비결정
  값은 전부 호스트가 `opts` 로 주입한다. Node 전용 API 도 쓰지 않아 브라우저 번들이 가능하다
  (`sha256` 을 직접 구현한 이유다).
- **값은 원문 문자열** — 숫자 파싱을 하지 않는다. Oracle NUMBER 38자리를 double 로 왕복시키면
  훼손된다. NULL 은 빈 문자열과 구별해 `null` 로 담는다.
- **결정 알고리즘만** — 인코딩 판별은 strict UTF-8 → strict CP949 → 실패. 통계 기반 감지는
  구현마다 판정이 갈려 패리티를 깬다.
- **데이터 문제는 Report** — 예외는 프로그래밍 오류(잘못된 타입)뿐이다.
- **조용한 폴백 없음** — 마커가 있는데 논스가 안 맞으면 CSV 로 흘러내리지 않고
  `PARTIAL_MARKING` 으로 하드 실패한다.

## 아직 없는 것

`render` 는 계약만 있고 구현은 소비자 몫이다. 레퍼런스 렌더러(sqlite-bundle·text)와 그
표현 스키마는 렌더러를 실제로 만들 때 `renderers/` 로 들어온다. xlsx 입력도 아직 없다.
