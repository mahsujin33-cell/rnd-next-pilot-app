# R&D NEXT Multi-Agent Pilot

R&D 과제를 Technology, Industry, Policy, Challenger, Transition, NEXT Synthesizer 관점으로 분석하는 한국어 파일럿입니다. Node.js 표준 기능만 사용하며 OpenAI SDK는 필요하지 않습니다. 사용자가 입력한 과제와 선택적 종료보고서만 분석 대상으로 삼고, 분석 직전에 NTIS 논문·특허·연구보고서 성과를 자동 조회해 참고 근거로만 추가합니다. OpenAI 키가 없거나 실제 호출이 실패하면 기존 Mock 흐름으로 전환됩니다.

## 실행과 실제 OpenAI 분석

Node.js 18 이상에서 다음과 같이 실행합니다.

```bash
node server.js
```

`http://localhost:8080`을 열고 다음 순서로 사용합니다.

1. 과제 정보(과제번호는 선택)와 선택적 종료보고서를 입력합니다.
2. 실제 분석을 원하면 `이번 분석용 OpenAI API Key`를 입력합니다.
3. `분석 시작`을 누릅니다. 후보 선택 없이 프로젝트가 생성되며, 서버가 먼저 NTIS 성과를 자동 조회합니다.
4. NTIS 키 미설정, API 장애, 결과 없음, 일부 컬렉션 실패 모두 빈 결과 또는 부분 결과로 표시하고 분석을 계속합니다.
5. OpenAI 성공 시 6개 결과가 모두 채워집니다. 키 미입력 또는 OpenAI 오류 시 오류 이유를 표시하고 Mock 분석으로 계속합니다.

모델은 `OPENAI_MODEL` 환경변수로 변경할 수 있고 기본값은 `gpt-4o-mini`입니다.

```bash
OPENAI_MODEL=gpt-4o-mini PORT=3000 node server.js
```

실제 호출 순서는 `Technology + Industry + Policy (병렬) → Challenger → Transition → NEXT Synthesizer`입니다. 첫 세 진단이 모두 성공하기 전에는 Challenger를 시작하지 않고, 각 후속 단계도 직전 단계 성공 후에만 시작합니다. 실제 모드에서는 NDJSON 단계 이벤트를 받아 대기/분석중/완료 타임라인과 결과를 즉시 갱신하며, 최종 응답 때 6개 결과를 한꺼번에 완료 처리하지 않습니다. Transition/NEXT Synthesizer 수동 버튼은 Mock 모드에서만 표시됩니다.

## API

서버의 `.env` 또는 실행 환경에 `NTIS_API_KEY`를 설정하면 브라우저에 키를 노출하지 않고 NTIS 전문기관용 `natRnDAllSearch`를 사용합니다.

```bash
NTIS_API_KEY=발급키 node server.js
```

`POST /api/ntis/achievements`는 `{ "project": { "name", "organization", "id" } }`를 받아 `rpaper`, `rpatent`, `rresearch`를 병렬 조회합니다. 응답은 정규화된 메타데이터만 포함하는 `{success, results, counts, warnings, source}`이며 인증키와 원문 XML은 반환하지 않습니다. 각 컬렉션은 10건, 응답 본문은 2 MiB, 요청 시간은 10초로 제한됩니다.

`POST /api/agents/run`은 `application/json` 본문을 받습니다.

```json
{
  "apiKey": "사용자가 이번 실행에만 제공한 키",
  "stream": true,
  "agents": ["technology", "industry", "policy", "challenger", "transition", "final"],
  "analysisInput": {
    "analysisTarget": { "id": "선택 과제번호", "name": "사용자가 입력한 분석 대상", "field": "분야", "organization": "기관" },
    "reportContent": { "name": "report.pdf", "size": 1234, "extension": "pdf", "extractionStatus": "available", "parser": "kordoc", "content": "추출 본문" },
    "ntisReference": null,
    "ntisAchievements": [{ "collection": "rpaper", "type": "paper", "id": "성과 ID", "title": "성과명", "projectId": "관련 과제번호" }]
  }
}
```

- 키는 필수이며 요청 처리 중 메모리에서만 사용합니다. 응답, 프로젝트, 파일, 로그에 기록하지 않습니다.
- `agents`는 허용된 6개 이름 중 중복 없는 1~6개입니다. UI는 항상 6개를 요청합니다.
- JSON 요청은 256 KiB, 보고서 본문은 50,000자, 모델 출력은 에이전트당 3,600 토큰으로 제한됩니다.
- 모든 응답은 호환 필드 `{name, subtitle, score, summary, strengths, risks, insight}`를 유지합니다.
- Technology/Industry/Policy에는 `conclusion`, `keyFindings`(3~6), `evidence`(3~6; `claim`, `source`, `sourceType`, `pageOrId`, `certainty`), `uncertainties`(3~5), `bottlenecks`(2~4), `nextCandidates`(2~4), `dataRequests`(2~5), `confidenceRationale`가 추가됩니다.
- Challenger에는 `critiques.technology`, `critiques.industry`, `critiques.policy`가 있으며 각 비판은 `verdict`, `counterArguments`(2~4), `weakEvidence`(2~4), `verificationQuestions`(2~4), `reversalConditions`(1~3)를 포함합니다. 최상위에는 `crossAgentConflicts`, `overallAssessment`, `confidenceRationale`가 포함됩니다.
- Transition에는 `routeCandidates` 2~3개가 포함됩니다. 각 후보는 `route`, `rationale`, `preconditions`, `bottleneck`, `actions`, `evidence`, `missingData`를 가지며, 최상위 `recommendedRoute`가 후보 비교 결과를 명시합니다.
- NEXT Synthesizer에는 `primaryNext`(후속 R&D/실증/기술이전/표준화/민간주도 전환/추가 판단 필요), `bottleneck`, `bottleneckEvidence`, `decision`, `preconditions`(2~5), `executionPlan`(3~6; action/owner/time/KPI), `rejectedAlternatives`(1~4; route/reason), `confidence`, `confidenceRationale`, `reassessmentTriggers`(1~4)가 포함됩니다. 근거가 없는 담당·시점·KPI는 `확인 필요`로 표시하고, 병목명과 경로가 없는 일반론은 허용하지 않습니다.
- `stream: true`이면 응답은 `application/x-ndjson`이며 `phase`(running/completed), `agent`(completed result), 마지막 `complete` 또는 `error` 이벤트를 순서대로 보냅니다. `stream`을 생략하면 기존 단일 JSON 응답을 유지합니다.
- OpenAI 요청은 strict JSON Schema를 사용합니다. 입력에 없는 사실·정책·수치·페이지를 생성하지 않으며 미확인 값은 `확인 불가` 또는 `추가 판단 필요`로 명시합니다.
- Mock의 상세 문구는 모두 `[DEMO]`로 표시되며 실제 과제 조사나 실시간 근거가 아닙니다.
- OpenAI 오류 응답 본문은 외부로 반환하지 않습니다. 401·429·서비스 오류는 키가 없는 안전한 한국어 메시지와 실패 Agent 단계로 정규화합니다. 완료된 실제 결과는 부분 응답으로 보존하며, UI에서 실패 단계 재시도 또는 사용자가 명시적으로 선택한 Mock 계속을 제공합니다.
- 서버 프롬프트는 보고서·NTIS·선행 Agent 결과를 단계별로 축약하고 전체 길이를 제한합니다. strict `json_schema`가 400으로 거부된 호출만 `json_object`로 한 번 재시도한 뒤 동일한 정규화 경로를 거칩니다.

`GET /api/health`는 `agentRunner`, 선택 모델, 문서 파서와 NTIS 설정 상태를 반환합니다. `POST /api/documents/parse`는 PDF/HWP/HWPX를 kordoc으로 파싱합니다.

## 개인정보·비용 주의

> 이 direct-key 파일럿은 신뢰할 수 있는 `localhost` 또는 신뢰할 수 있는 서버의 HTTPS 연결에서만 사용하세요. HTTP 원격 접속, 공용·공유 서버, 신뢰할 수 없는 프록시에서는 키를 입력하지 마세요. 프로덕션에서는 브라우저로 사용자 키를 전달받지 말고, 인증·권한·사용량 통제가 적용된 서버 측 비밀관리 저장소의 키를 사용해야 합니다.

- OpenAI 키는 매 실행마다 입력하며 DOM 입력값과 요청 처리 메모리에만 일시적으로 존재합니다. `localStorage`, 프로젝트 객체, 보고서 내보내기, `preview.html`, 서버 로그에 저장하지 않습니다.
- 브라우저 개발자 도구의 네트워크 요청에는 전송 중인 요청 본문이 보일 수 있으므로 공유 기기에서 사용하지 마세요.
- 실제 실행은 기본 6회의 API 호출을 만들며(스키마 호환 폴백 시 해당 단계 1회 추가) OpenAI 계정에 비용이 청구되고 모델별 속도·토큰·결제 한도가 적용됩니다. 실패 시 자동으로 Mock 결과를 덮어쓰지 않습니다.
- 과제와 추출된 보고서 텍스트는 브라우저 `localStorage`에 저장됩니다. 민감하거나 비공개인 보고서는 이 파일럿에 넣지 마세요.
- 서버와 프록시에서 요청 본문/Authorization 헤더 로깅을 꺼야 합니다. 현재 앱 서버는 둘 다 로그로 출력하지 않습니다.

## 근거와 가드레일

모든 Agent는 사용자가 입력한 과제만 분석 대상으로 삼고, 종료보고서·정규화된 NTIS 성과·선행 Agent 결과는 참고 근거로만 사용합니다. 외부 사실을 발명하지 않고, 확인할 수 없는 내용은 `확인 불가` 또는 `추가 판단 필요`로 표시하도록 프롬프트에서 강제합니다. 보고서 본문과 메타데이터는 제한 범위 안에서 함께 전달됩니다. 자세한 역할 경계는 [AGENT-GUARDRAILS.md](AGENT-GUARDRAILS.md)에 있습니다.

## 문서 처리

- PDF/HWP/HWPX는 서버에서 요청별 임시 파일로 kordoc 파싱 후 항상 삭제합니다.
- TXT/MD/HTML/CSV/JSON은 브라우저가 최대 50,000자를 읽습니다.
- DOC/DOCX는 현재 메타데이터만 사용합니다. 읽지 못한 본문을 추정하지 않습니다.
- 추출 텍스트와 축약 메타데이터는 분석 입력에 포함되며, Markdown 내보내기 발췌는 4,000자로 제한됩니다.
- 정적 `preview.html` 또는 `index.html` 직접 열기에는 API 서버가 없으므로 실제 분석은 실패 상태로 표시되며, 사용자가 선택하면 Mock 흐름으로 계속할 수 있습니다.

## 검증

```bash
node --check server.js
node --check app.js
node --check project-model.js
node regression-target-reference.test.js
node pipeline-resilience.test.js
node pipeline-progress.test.js
node generate-preview.js
node server.js
curl -s http://localhost:8080/api/health
curl -s -X POST http://localhost:8080/api/ntis/achievements \
  -H 'Content-Type: application/json' \
  --data '{"project":{"name":"테스트 과제","organization":"테스트 기관"}}'
curl -s -X POST http://localhost:8080/api/agents/run \
  -H 'Content-Type: application/json' \
  --data '{"apiKey":"sk-deliberately-invalid-placeholder-123456","agents":["technology"],"analysisInput":{"analysisTarget":{"name":"test"},"reportContent":null,"ntisReference":null,"ntisAchievements":[]}}'
```

마지막 요청은 401의 안전한 오류를 반환해야 하며 응답과 서버 출력 어디에도 placeholder 키가 나타나면 안 됩니다.

## 파일

- `index.html`, `styles.css`, `project-model.js`, `app.js` — 앱 UI, 대상/참고자료 모델, 실제 실행 및 Mock 폴백
- `server.js` — 정적 제공, NTIS 성과 조회, OpenAI 오케스트레이션, 문서 파싱
- `preview.html` — CSS/JS가 인라인된 정적 미리보기
- `AGENT-GUARDRAILS.md` — Agent 역할과 실행·보안 경계
