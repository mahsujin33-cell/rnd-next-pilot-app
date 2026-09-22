# R&D NEXT 에이전트 정의 및 가드레일

이 문서는 파일럿 앱에서 사용하는 Technology, Industry, Policy, Challenger, Transition, NEXT Synthesizer의 분석 책임과 판단 경계를 정의합니다. 화면의 `분석 기준`과 같은 내용을 사용합니다.

## 실행 원칙

0. 사용자가 직접 입력한 과제와 그 과제에 첨부한 종료보고서만 분석 대상입니다. 자동 조회한 NTIS 성과는 별도의 참고·보강 근거이며, 성과의 제목·기관·관련 과제를 분석 대상으로 치환하거나 대상 정보에 덮어쓰지 않습니다.
1. Technology, Industry, Policy가 서로의 결론을 대신하지 않고 병렬로 1차 진단합니다.
2. 세 진단이 완료되면 Challenger가 자동으로 교차 검증합니다.
3. 실제 OpenAI 모드에서는 첫 세 진단이 모두 성공한 뒤에만 Challenger를 시작하고, Challenger 성공 뒤 Transition, Transition 성공 뒤 NEXT Synthesizer를 서버가 순차 실행합니다. 서버의 NDJSON 단계 이벤트가 화면의 대기/분석중/완료 타임라인과 결과 공개 시점을 결정합니다. Mock 모드에서도 동일한 순서를 타임라인으로 보여주며 Transition과 NEXT Synthesizer만 사용자가 버튼으로 실행합니다.
5. Transition은 하나의 경로를 강제하지 않고, 근거가 부족하면 `추가 판단 필요`라고 명시합니다.
6. NEXT Synthesizer는 Transition 완료 후에도 근거·반론·선결조건을 확인하며, 근거가 부족하면 결정을 강제하지 않습니다.
7. 종료보고서는 선택 입력입니다. 첨부가 없거나 NTIS 성과 조회 결과가 없어도 수동 과제정보로 분석 흐름을 중단하지 않습니다.
8. `.txt`, `.md`, `.html`, `.csv`, `.json`에서 브라우저가 실제로 읽은 텍스트와, 백엔드 kordoc이 PDF/HWP/HWPX에서 실제로 반환한 Markdown만 보고서 근거로 취급합니다. 분석 입력 텍스트는 최대 50,000자까지만 저장합니다.
9. PDF/HWP/HWPX는 `node server.js`로 실행했을 때만 kordoc 백엔드 파싱을 시도합니다. 백엔드 연결 불가 상태는 `백엔드 파싱 대기`, 파서 실패는 `파싱 실패`로 구분합니다. DOC/DOCX는 메타데이터만 확인합니다. 추출되지 않은 본문 내용·요약·근거를 추정하거나 만들어내면 안 됩니다.
10. 화면과 내보내기는 실제로 확보한 입력에 따라 `분석 대상`, `NTIS 성과 근거`, `종료보고서`, `기존 NTIS 참고자료`를 구분해 표시합니다. 첨부 표시는 본문 추출 가능 여부와 무관하게 파일이 입력되었다는 뜻이며, 본문을 읽었다는 뜻이 아닙니다.
11. 프로젝트 정보는 사용자가 직접 입력합니다. 후보 선택 단계는 없습니다. 분석 시작 전에 서버가 `NTIS_API_KEY`로 `natRnDAllSearch`의 `rpaper`, `rpatent`, `rresearch`를 병렬 조회합니다. 키 미설정·API 장애·무결과·일부 실패는 정직하게 표시하고 빈 결과 또는 부분 결과로 분석을 계속합니다.
12. OpenAI API Key는 분석 실행마다 하나만 입력하며, 같은 실행의 Technology, Industry, Policy, Challenger, Transition, NEXT Synthesizer 전체가 그 키 하나를 공유합니다. 실제 호출 성공 여부와 무관하게 입력 필드는 시작 직후 지웁니다. Mock 분석에는 키가 필요하지 않습니다.
13. NTIS/OpenAI 키 원문은 에이전트 입력, `FormData`, 프로젝트 객체, `localStorage`, 내보낸 보고서, 샘플 데이터, 로그, 미리보기 HTML에 포함하지 않습니다.
14. 등록 시 OpenAI 입력을 즉시 지우고 프로젝트에는 `openaiKeyConfigured`와 `ntisConfigured` Boolean만 남깁니다. 이 값은 실행 당시의 상태일 뿐 인증정보가 아닙니다. 이전 `apiKeyConfigured` Boolean은 원문 키 없이 호환 마이그레이션합니다.

## 자격증명 보안 경계

- `POST /api/agents/run`은 사용자가 이번 실행에 제공한 키를 Node 메모리에서만 사용해 OpenAI Chat Completions를 호출합니다. 서버는 키나 OpenAI 오류 원문을 로그·응답·파일·프로젝트에 기록하지 않습니다.
- 브라우저 입력값은 등록 직후 삭제하며 `localStorage`와 내보내기에 넣지 않습니다. 클라이언트는 OpenAI를 직접 호출하지 않고 같은 출처의 파일럿 서버에만 키를 전달합니다.
- 실제 NTIS 자동 조회는 백엔드의 `NTIS_API_KEY` 환경변수 또는 동등한 비밀관리 구성이 필요합니다. 키는 URL 구성에만 사용하고 로그·응답·원문 오류에 넣지 않으며, 클라이언트에는 설정 여부와 정규화된 성과 메타데이터만 전달합니다.
- direct-key 모드는 신뢰할 수 있는 localhost 또는 HTTPS에서만 사용합니다. 원격 HTTP, 공용 서버, 신뢰할 수 없는 프록시에서 키를 입력하면 안 됩니다.
- 프로덕션은 브라우저에서 사용자 키를 받는 이 방식을 사용하지 않습니다. 인증·권한·사용량 제한이 적용된 서버 측 비밀관리 저장소의 키를 사용하고 TLS, 요청/헤더 로그 차단, 키 회전 절차를 적용해야 합니다.
- 실제 분석은 기본 6회의 유료 API 호출이며 strict JSON Schema 호환 폴백이 필요한 단계는 1회 추가될 수 있습니다. 실패 단계와 안전한 원인을 표시하고 완료 결과를 보존하며, Mock 계속은 사용자가 명시적으로 선택해야 합니다.
- 요청 JSON은 256 KiB, 저장 보고서 본문은 50,000자, 실제 단계별 프롬프트는 최대 42,000자, 에이전트 수는 6개, 에이전트별 모델 출력은 3,600 토큰으로 제한합니다. 후반 Agent에는 필요한 선행 결과의 축약본만 전달하고 단계별 제한 시간은 45~65초입니다. `OPENAI_MODEL` 기본값은 `gpt-4o-mini`입니다.
- NTIS 출처 상태와 실제/Mock 분석 결과를 화면과 내보내기에 구분합니다. NTIS 성과는 항상 참고 근거이며 분석 대상이 아닙니다.

## OpenAI 실행 경계

- NTIS 엔드포인트: `POST /api/ntis/achievements`, 본문 `{project: {id?, name, organization}}`, 응답 `{success, results, counts, warnings, source}`. 3개 컬렉션은 병렬 호출하고 컬렉션당 10건, 응답 2 MiB, 10초로 제한합니다.
- OpenAI 엔드포인트: `POST /api/agents/run`, 본문 `{apiKey, agents, analysisInput: {analysisTarget, reportContent, ntisReference, ntisAchievements}}`
- 허용 Agent: `technology`, `industry`, `policy`, `challenger`, `transition`, `final` (중복 없는 1~6개)
- 전체 실행 순서: Technology/Industry/Policy 병렬 → Challenger → Transition → NEXT Synthesizer
- 각 프롬프트는 아래 역할·판단 기준·금지 행동을 포함하고, `analysisTarget`만 대상으로 삼으며 보고서·NTIS 성과·선행 결과는 근거로만 사용합니다.
- 입력에서 확인되지 않은 사실·수치·출처·기업·정책을 만들지 않습니다. 알 수 없는 내용은 `확인 불가` 또는 `추가 판단 필요`로 표시합니다.
- 공통 호환 출력: `name`, `subtitle`, `score`, `summary`, `strengths`, `risks`, `insight`

## 상세 출력 계약

OpenAI 출력은 Agent별 strict JSON Schema로 검증합니다. Technology, Industry, Policy는 공통 호환 출력에 아래 필드를 추가합니다.

- `conclusion`: 해당 도메인의 명시적 판정
- `keyFindings`: 3~6개 핵심 발견
- `evidence`: 3~6개 근거 객체. 각 객체는 `claim`, `source`, `sourceType`, `pageOrId`, `certainty`를 포함
- `uncertainties`: 3~5개 불확실성
- `bottlenecks`: 2~4개 핵심 병목
- `nextCandidates`: 2~4개 후속 후보
- `dataRequests`: 2~5개 추가 데이터 요청
- `confidenceRationale`: 점수와 판정 신뢰도의 근거

Challenger는 `critiques.technology`, `critiques.industry`, `critiques.policy`를 모두 출력합니다. 각 도메인 비판은 `verdict`, `counterArguments` 2~4개, `weakEvidence` 2~4개, `verificationQuestions` 2~4개, `reversalConditions` 1~3개를 포함합니다. 최상위에는 `crossAgentConflicts`, `overallAssessment`, `confidenceRationale`를 포함합니다.

근거의 `source`는 실제 입력 구획인 `수동 입력 대상`, `종료보고서`, `NTIS 성과 근거`를 구분합니다. NTIS 항목은 끝까지 참고 근거이며 수동 입력 대상을 대체하지 않습니다. 입력에 없는 사실, 수치, 출처, 정책명, 페이지 번호는 생성하지 않고 `확인 불가` 또는 `추가 판단 필요`로 기록합니다. 기존 저장 데이터는 호환 필드만 있어도 계속 표시되며, 구조화 상세 영역에는 기존 형식임을 명시합니다. Mock 상세 결과는 `[DEMO]`로 표기합니다.

## 실행 및 문서 파싱 경계

- 정확한 실행 명령: `node server.js` (기본 주소 `http://localhost:8080`, 포트 변경은 `PORT=3000 node server.js`)
- `POST /api/documents/parse`는 `document` multipart 필드의 PDF/HWP/HWPX만 받습니다.
- 서버는 요청별 임시 파일을 만들고 `npx --yes --package kordoc --package pdfjs-dist kordoc <임시파일> --format json`을 실행한 뒤 `finally` 단계에서 임시 디렉터리를 삭제합니다.
- 성공 응답의 실제 Markdown/JSON만 분석 입력으로 전달합니다. 경고, 빈 Markdown, 손상·암호화 문서, 이미지 기반 PDF의 OCR 한계는 숨기지 않습니다.

## 종료보고서 입력 경계

- 허용 형식: PDF, DOC, DOCX, HWP, HWPX, TXT, MD, HTML, CSV, JSON
- 공통 입력: 파일명, 크기, MIME 형식, 확장자, 최종 수정시각
- 텍스트 형식 추가 입력: 브라우저 `FileReader`로 읽은 실제 텍스트(최대 50,000자)
- PDF/HWP/HWPX 추가 입력: kordoc이 실제 반환한 Markdown과 축약 구조 메타데이터. 연결 불가·실패 시 메타데이터만 입력
- 내보내기: 실제 추출 텍스트가 있을 때만 최대 4,000자의 발췌를 포함하고, 그 외에는 추출 불가 안내만 포함
- 보안·저장: 원본 PDF/HWP/HWPX는 서버 임시 파일로만 처리하고 요청 종료 시 삭제. 추출 텍스트는 브라우저 `localStorage`에 저장되므로 민감정보 처리를 전제로 하지 않음

## Technology

- 역할: 해당 R&D 기술의 현재 기술성숙도와 기술적 후속 필요성을 판단합니다.
- 입력 범위: 과제 공개정보, 논문, 특허, 기술로드맵
- 핵심 판단 기준:
  - 기술성숙도(TRL)
  - 핵심기술 확보 수준
  - 목표 대비 성능달성도
  - 미해결 기술문제와 기술적 병목
  - 경쟁기술 대비 우위·열위
  - 기술발전 속도와 대체기술 등장 가능성
  - 기술 통합·확장 가능성
  - 실험실 수준과 실제환경 적용 간 격차
- 금지 결론: 시장성이나 정책 필요성을 최종 판단하지 않음
- 출력 필드: 공통 호환 필드 + 판정, 핵심 발견, 구조화 근거, 불확실성, 병목, 다음 후보, 데이터 요청, 신뢰도 근거

## Industry

- 역할: 민간 시장과 산업 수요 관점에서 후속 지원 필요성을 판단합니다.
- 입력 범위: 기업투자, 시장동향, 경쟁제품, 수요정보
- 핵심 판단 기준:
  - 시장 형성 수준
  - 실제 수요기업 존재 여부
  - 민간투자 규모와 증가 추세
  - 상용제품·서비스 존재 여부
  - 경쟁기업 수
  - 산업 내 기술채택 속도
  - 고객의 지불의사
  - 공급망 형성 수준
  - 시장진입장벽
  - 해외기업 의존도
  - 국내기업 경쟁력
  - 민간이 자체적으로 기술개발을 지속할 가능성
- 금지 결론: 시장성숙도·민간투자·수요기업 존재 여부를 독자적으로 확정하지 않음
- 출력 필드: 공통 호환 필드 + 판정, 핵심 발견, 구조화 근거, 불확실성, 병목, 다음 후보, 데이터 요청, 신뢰도 근거

> **잠정 문구:** Industry의 금지 결론은 사용자 정의가 완성될 때까지 위 표현을 임시로 사용합니다.

## Policy

- 역할: 해당 R&D 기술·성과에 대해 국가정책, 정부 역할, 공공적 필요성 측면에서 추가적인 정부 R&D 개입이 필요한지 판단합니다.
- 입력 범위: 국가전략, 정부 정책·계획, 부처별 시행·계획, 예산방향, 기존·신규 R&D 사업, 법·제도 변화, 해외 주요국 정책동향
- 핵심 판단 기준:
  - 국가전략과의 부합성
  - 정부개입 필요성
  - 시장실패 가능성
  - 전략기술 해당 여부
  - 공공성·사회적 파급효과
  - 기존 정부지원과의 중복 가능성
  - 정책환경 변화
- 금지 결론: 기술성숙도나 시장규모를 독자적으로 확정하지 않음. 국가전략 포함만으로 추가 정부지원이 필요하다고 결론내리지 않음. Technology·Industry 판단 없이 후속 R&D 여부를 단독 결정하지 않음.
- 출력 필드: 공통 호환 필드 + 판정, 핵심 발견, 구조화 근거, 불확실성, 병목, 다음 후보, 데이터 요청, 신뢰도 근거

## Challenger

- 역할: Technology·Industry·Policy Agent가 제시한 판단과 근거를 비판적으로 검토하고 논리적 비약·근거 부족·상충되는 주장·확증편향을 찾아 최종 판단의 신뢰도를 높입니다.
- 입력 범위: Technology·Industry·Policy 분석결과, 각 Agent가 제시한 근거자료와 출처
- 핵심 판단 기준:
  - 주장과 근거의 연결성
  - Agent 간 판단 불일치
  - 근거의 최신성·신뢰성
  - 반대근거 존재 여부
  - 인과관계와 단순 상관관계의 혼동
  - 정부지원 필요성에 대한 논리적 비약
  - 과도한 낙관·비관 판단
- 금지 결론: 자신의 선호에 따라 새로운 결론을 임의로 제시하지 않음. 반대를 위한 반대를 하지 않음. 근거 없이 다른 Agent의 판단을 부정하지 않음. 최종 NEXT를 단독 결정하지 않음.
- 출력 필드: 기술·산업·정책별 판정·반론·약한 근거·검증 질문·판단 반전 조건, Agent 간 충돌, 종합 평가, 신뢰도 근거

## Transition

- 역할: Technology·Industry·Policy 진단과 Challenger 검증 결과를 바탕으로 현실적인 후속 전환 후보 경로 2~3개와 각 경로의 선결조건, 병목, 추가 필요 정보를 도출합니다.
- 입력: Technology Agent 결과, Industry Agent 결과, Policy Agent 결과, Challenger 결과, 공개된 기술이전·실증·표준화·사업화·후속 R&D 사례, 관련 지원사업 및 제도정보
- 판단 기준:
  - 기술성숙도와 요구 TRL 간 적합성
  - 실제 수요 존재 여부
  - 민간의 후속투자 가능성
  - 실증 필요성
  - 표준·인증 필요성
  - 기술이전 가능조건
  - 후속 R&D 필요성
  - 정책수단 간 적합성
  - 다음 단계로 이동하기 위해 해결해야 할 핵심 병목
- 금지 행동: 사업을 직접 실행하거나 특정 기업으로의 기술이전을 결정하지 않음. 새로운 기술·시장·정책 판단을 임의로 만들지 않음. 하나의 경로를 강제하지 않음. 근거가 부족하면 반드시 `추가 판단 필요`라고 명시함
- 출력: `routeCandidates` 2~3개. 각 후보는 `route`, `rationale`, `preconditions`, `bottleneck`, `actions`, `evidence`, `missingData`를 포함하며, 최상위 `recommendedRoute`로 비교 결과를 명시합니다. 근거 부족 시 `추가 판단 필요`를 사용합니다.

## NEXT Synthesizer

- 역할: Transition이 도출한 후보 경로 중 하나의 주요 NEXT를 선정하고, 1~2개의 대안과 선정 이유, 미선정 경로의 제외 이유, 신뢰도, 다음 행동을 제시합니다.
- 입력: Transition의 후보 경로·선결조건·병목·추가 필요 정보, Technology·Industry·Policy의 진단 근거, Challenger의 반론·검증 조건
- 판단 기준:
  - 핵심 병목 해결 적합성
  - 선행조건 충족도
  - 전환 준비도
  - Agent 간 판단 일관성
  - Challenger 검증결과
  - 근거 신뢰도
  - 경로 간 순차·병행 관계
- 금지 행동: 근거를 임의로 만들지 않음. 점수만으로 기계적으로 선정하지 않음. Challenger의 반론이나 충족되지 않은 선결조건을 무시하지 않음. 근거가 부족한데도 결정을 강제하지 않음
- 출력: `primaryNext`(후속 R&D/실증/기술이전/표준화/민간주도 전환/추가 판단 필요), 구체적인 `bottleneck`, `bottleneckEvidence`, 경로 선택 이유인 `decision`, `preconditions` 2~5개, `executionPlan` 3~6개(`action`, `owner`, `time`, `KPI`), `rejectedAlternatives` 1~4개(`route`, `reason`), `confidence`, `confidenceRationale`, `reassessmentTriggers` 1~4개
- 구체성 규칙: `병목 해결이 필요합니다`처럼 병목명과 선택 경로가 없는 문장은 허용하지 않습니다. 입력 근거가 담당자·시점·KPI를 뒷받침하지 않으면 각 필드를 `확인 필요`로 둡니다.
