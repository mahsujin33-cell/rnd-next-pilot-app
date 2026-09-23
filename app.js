(function () {
  "use strict";

  const STORAGE_KEY = "rnd-next-pilot-projects-v2";
  const COLORS = { "후속 R&D": "#3767e8", "실증": "#16a779", "기술이전": "#7c5ce4", "표준화": "#e59b2f", "민간주도 전환": "#dc5b66" };
  const REPORT_TEXT_LIMIT = 50000;
  const REPORT_READ_BYTE_LIMIT = REPORT_TEXT_LIMIT * 4;
  const REPORT_EXPORT_EXCERPT_LIMIT = 4000;
  const TEXT_REPORT_EXTENSIONS = new Set(["txt", "md", "html", "csv", "json"]);
  const BACKEND_REPORT_EXTENSIONS = new Set(["pdf", "hwp", "hwpx"]);
  const ALLOWED_REPORT_EXTENSIONS = new Set(["pdf", "doc", "docx", "hwp", "hwpx", ...TEXT_REPORT_EXTENSIONS]);
  const NTIS_CONFIGURED = document.querySelector('meta[name="rnd-next-ntis-configured"]')?.content === "true";
  const ProjectModel = window.RndNextProjectModel;

  function redactCredentialText(value) {
    return String(value ?? "")
      .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_OPENAI_KEY]")
      .replace(/((?:NTIS|OPENAI)_API_KEY\s*[:=]\s*)[^\s'";,]+/gi, "$1[REDACTED]");
  }

  function sanitizeProjectCredentials(project) {
    if (!project || typeof project !== "object") return project;
    Object.keys(project).forEach((key) => {
      if (/^(?:apiKey|llmApiKey|openaiApiKey|ntisApiKey|secret|accessToken)$/i.test(key)) {
        delete project[key];
        return;
      }
      const value = project[key];
      if (typeof value === "string") project[key] = redactCredentialText(value);
      else if (value && typeof value === "object") sanitizeProjectCredentials(value);
    });
    return project;
  }

  const sampleProject = {
    id: "rnd-2026-001",
    name: "AI 기반 차세대 배터리 수명 예측 및 안전 진단 플랫폼 개발",
    field: "에너지·환경",
    organization: "한국에너지융합연구원",
    ntisId: "NTIS-2024-ER-01842",
    ntisReference: { id: "NTIS-2024-ER-01842", title: "AI 기반 산업 설비 고장 예지 및 자율 진단 기술 개발", org: "한국산업기술연구원", period: "2024–2027", similarity: 94 },
    period: "2024.03 – 2027.02",
    budget: "42.5억원",
    nextType: "실증",
    status: "검토 대기",
    progress: 100,
    createdAt: "2026-09-16T09:30:00.000Z",
    bottleneck: "실증 데이터 접근성",
    openaiKeyConfigured: false,
    ntisConfigured: false,
    agentResults: {
      technology: { name: "Technology", subtitle: "기술 경쟁력 분석", score: 82, summary: "배터리 열화 상태를 설명 가능한 AI로 추정하는 핵심 기술은 차별성이 높습니다. 다만 다양한 셀 화학계에 대한 일반화 검증이 필요합니다.", strengths: ["시계열·임피던스 복합 데이터 모델링 역량", "실험실 기준 TRL 5 수준의 시제품 확보", "진단 결과의 원인 설명 기능 보유"], risks: ["상용 운행 데이터 규모가 충분하지 않음", "LFP·전고체 등 신규 화학계 검증 필요"], insight: "단일 예측 정확도 경쟁보다 ‘안전 의사결정 지원’ 기술로 재정의하면 방어 가능한 기술 우위를 만들 수 있습니다." },
      industry: { name: "Industry", subtitle: "시장·산업 분석", score: 76, summary: "전기차 및 ESS 안전 규제 강화로 수요가 빠르게 늘고 있습니다. 완성차 직접 공급보다 BMS 기업과의 공동 제품화가 초기 진입에 유리합니다.", strengths: ["BMS·배터리 재사용 시장 동시 적용 가능", "안전 진단 SaaS로 반복 매출 구조 설계 가능", "국내 셀 제조사 생태계와 높은 인접성"], risks: ["완성차 검증과 공급사 등록에 장기간 소요", "글로벌 BMS 업체의 내재화 가능성"], insight: "재사용 배터리 등급 판정 시장을 첫 번째 비치헤드로 삼아 검증 데이터를 축적하는 경로가 현실적입니다." },
      policy: { name: "Policy", subtitle: "정책 부합성 분석", score: 88, summary: "배터리 전주기 안전관리와 순환경제라는 국가 전략에 직접 부합합니다. 공공 실증 인프라 연계 가능성도 높습니다.", strengths: ["사용후 배터리 안전성 검사 제도와 연계", "탄소중립·순환경제 정책 기여도 명확", "지역 규제자유특구 실증 연계 가능"], risks: ["데이터 소유권 및 국외 이전 기준 불확실", "안전 인증 책임 범위에 대한 제도 보완 필요"], insight: "정책 과제의 표현을 ‘예측 기술’에서 ‘배터리 전주기 안전 신뢰체계’로 확장할 필요가 있습니다." },
      challenger: { name: "Challenger", subtitle: "반론·취약점 검증", score: 61, summary: "현재 계획은 높은 예측 정확도가 구매로 직결된다는 가정에 의존합니다. 현장에서는 정확도보다 책임 소재와 기존 BMS 연동비용이 더 큰 장벽일 수 있습니다.", strengths: ["기술 실현 가능성 자체는 충분히 입증", "복수 응용시장으로 피벗 가능한 구조"], risks: ["고객의 지불의사 검증이 부족함", "사고 발생 시 알고리즘 책임 기준 부재", "데이터 파트너 확보가 계획보다 지연될 가능성"], insight: "정확도 목표를 추가하기 전에 유료 실증 파트너와 책임 분담 구조를 먼저 확정해야 합니다." },
      transition: { name: "Transition", subtitle: "전환 경로 설계", score: 84, summary: "원천 모델 개발 중심의 과제를 실증·제품화 중심으로 전환해야 합니다. 18개월 내 재사용 배터리 판정 서비스 출시가 권고됩니다.", strengths: ["기존 모델과 시제품을 즉시 활용 가능", "단계별 성과지표 전환이 용이", "규제특구·공공 실증 자원 연계 가능"], risks: ["참여기관 역할과 예산 재배분 필요", "제품 책임·보안 역량 보강 필요"], insight: "1단계 데이터 계약, 2단계 현장 검증, 3단계 인증 패키지의 3-게이트 방식으로 예산을 집행하세요." },
      final: { name: "NEXT Synthesizer", subtitle: "통합 판단 및 권고", score: 84, summary: "기술개발 지속보다 시장 검증 중심으로 목적을 전환할 시점입니다. 핵심 알고리즘은 유지하되 목표·컨소시엄·성과지표를 제품화 기준으로 재구성합니다.", strengths: ["기술·정책 측면에서 높은 지속 가치", "구체적인 초기 시장과 전환 경로 존재", "공공 실증을 통한 데이터 병목 해소 가능"], risks: ["민간 데이터 파트너 미확보 시 전환 효과 제한", "제품 책임 체계 없는 조기 상용화 위험"], insight: "X형·전환 권고: 잔여 기간의 60%를 현장 실증과 데이터 파트너십에 배분하고, 6개월 내 유료 PoC 계약을 전환 성공 기준으로 설정합니다." }
    }
  };

  // DEMO ONLY: concrete sample content for the no-key preview. These statements are not live findings.
  Object.assign(sampleProject.agentResults.technology, {
    conclusion: "[DEMO] 조건부 실증 진행: 현재 입력만으로 실험실 성능의 현장 일반화는 확정할 수 없으므로, 화학계·운용환경별 외부 검증을 통과한 뒤 제품화 단계로 이동해야 합니다.",
    keyFindings: ["[DEMO] 시계열과 임피던스 데이터를 함께 쓰는 진단 구조가 제시되어 있습니다.", "[DEMO] 설명 가능한 진단 결과를 안전 의사결정에 연결하는 방향이 핵심 차별화 후보입니다.", "[DEMO] LFP·전고체 등 학습 분포 밖 화학계에 대한 성능은 확인되지 않았습니다.", "[DEMO] 실험실 시제품과 차량·ESS 현장 환경 사이의 성능 격차가 핵심 검증 대상입니다."],
    evidence: [
      { claim: "[DEMO] 복합 센서 데이터 기반 모델링이 핵심 기술로 제시됨", source: "수동 입력 대상", sourceType: "과제 메타데이터", pageOrId: "rnd-2026-001", certainty: "중간" },
      { claim: "[DEMO] AI 기반 수명 예측과 안전 진단을 함께 목표로 함", source: "수동 입력 대상", sourceType: "과제명", pageOrId: "rnd-2026-001", certainty: "높음" },
      { claim: "[DEMO] 현장 일반화 성능을 입증할 시험 결과는 제공되지 않음", source: "종료보고서", sourceType: "미첨부", pageOrId: "확인 불가", certainty: "확인 불가" }
    ],
    uncertainties: ["[DEMO] 셀 화학계별 학습·검증 표본 수를 확인할 수 없습니다.", "[DEMO] 온도·충방전 패턴 변화에 대한 성능 저하 폭을 확인할 수 없습니다.", "[DEMO] 기준 BMS 대비 오탐·미탐 개선치를 확인할 수 없습니다."],
    bottlenecks: ["[DEMO] 제조사·운영사 현장 데이터 접근", "[DEMO] 안전 사고 시나리오를 포함한 외부 재현 검증"],
    nextCandidates: ["[DEMO] 재사용 배터리 등급 판정 현장 PoC", "[DEMO] BMS 연동형 진단 API 검증", "[DEMO] 화학계별 교차검증 벤치마크 구축"],
    dataRequests: ["[DEMO] 화학계·운용조건별 데이터 건수와 분할 기준", "[DEMO] 기준모델 대비 성능표와 신뢰구간", "[DEMO] 현장 장애·안전 이벤트 오탐/미탐 기록"],
    confidenceRationale: "[DEMO] 과제명과 샘플 설명은 방향성을 지지하지만 원자료·시험성적서·종료보고서가 없어 기술 판정 신뢰도는 중간 이하입니다."
  });
  Object.assign(sampleProject.agentResults.industry, {
    conclusion: "[DEMO] 제한적 시장 검증 우선: 완성차 직접 공급을 전제하기보다 재사용 배터리 판정 또는 BMS 협력 PoC에서 유료 수요를 먼저 확인해야 합니다.",
    keyFindings: ["[DEMO] BMS와 재사용 배터리 판정이 서로 다른 초기 고객군 후보입니다.", "[DEMO] 구매 결정에는 예측 정확도뿐 아니라 연동비용과 책임 배분이 영향을 줄 수 있습니다.", "[DEMO] 실제 수요기업·지불의사·도입예산 근거는 현재 입력에 없습니다.", "[DEMO] 공급사 등록과 장기 검증 절차가 시장 진입기간을 늘릴 수 있습니다."],
    evidence: [
      { claim: "[DEMO] 적용 제품군으로 배터리 진단 플랫폼이 제시됨", source: "수동 입력 대상", sourceType: "과제명", pageOrId: "rnd-2026-001", certainty: "높음" },
      { claim: "[DEMO] 특정 유료 고객이나 계약은 입력에서 확인되지 않음", source: "수동 입력 대상", sourceType: "과제 메타데이터", pageOrId: "rnd-2026-001", certainty: "높음" },
      { claim: "[DEMO] 시장규모·가격·경쟁제품 자료가 제공되지 않음", source: "종료보고서", sourceType: "미첨부", pageOrId: "확인 불가", certainty: "확인 불가" }
    ],
    uncertainties: ["[DEMO] 고객 세그먼트별 지불의사를 확인할 수 없습니다.", "[DEMO] 기존 BMS 통합에 필요한 기간과 비용을 확인할 수 없습니다.", "[DEMO] 경쟁 솔루션 대비 전환비용과 우위를 확인할 수 없습니다."],
    bottlenecks: ["[DEMO] 유료 실증 고객 확보", "[DEMO] BMS·운영 시스템 통합비용과 책임 구조"],
    nextCandidates: ["[DEMO] 재사용 배터리 사업자 대상 유료 PoC", "[DEMO] BMS 업체 공동제품 정의", "[DEMO] ESS 운영사 대상 안전진단 실증"],
    dataRequests: ["[DEMO] 고객 인터뷰와 구매의향서", "[DEMO] PoC 가격·통합 공수·전환비용", "[DEMO] 경쟁제품 기능·가격 비교표", "[DEMO] 공급사 등록 예상 일정"],
    confidenceRationale: "[DEMO] 적용처 가설은 구체적이지만 계약·시장조사·경쟁 데이터가 없어 시장성 판정은 낮은 신뢰도로 제한합니다."
  });
  Object.assign(sampleProject.agentResults.policy, {
    conclusion: "[DEMO] 공공 실증 필요성은 조건부 인정: 안전·순환경제 효과와 민간 단독으로 확보하기 어려운 공동 데이터 인프라가 입증될 때 정부 개입 논리가 성립합니다.",
    keyFindings: ["[DEMO] 배터리 안전과 재사용 판정은 공공 안전성과 연결될 가능성이 있습니다.", "[DEMO] 공공 실증 데이터 인프라는 다수 기업이 공동 활용할 수 있는 정책수단 후보입니다.", "[DEMO] 특정 국가전략·법령·예산사업과의 직접 부합성은 입력에서 확인되지 않았습니다.", "[DEMO] 기존 지원사업과의 중복 및 민간 대체 가능성 검토가 필요합니다."],
    evidence: [
      { claim: "[DEMO] 과제 목표에 안전 진단이 명시됨", source: "수동 입력 대상", sourceType: "과제명", pageOrId: "rnd-2026-001", certainty: "높음" },
      { claim: "[DEMO] 정책 문서나 법령 근거는 제공되지 않음", source: "수동 입력 대상", sourceType: "입력 누락", pageOrId: "확인 불가", certainty: "확인 불가" },
      { claim: "[DEMO] NTIS 참고자료는 분석 대상과 별개임", source: "NTIS 성과 근거", sourceType: "기존 참고자료", pageOrId: "NTIS-2024-ER-01842", certainty: "높음" }
    ],
    uncertainties: ["[DEMO] 적용 가능한 법정 검사·인증 체계를 확인할 수 없습니다.", "[DEMO] 기존 정부 R&D와의 중복 여부를 확인할 수 없습니다.", "[DEMO] 민간만으로 데이터 구축이 불가능한지 확인할 수 없습니다."],
    bottlenecks: ["[DEMO] 정책 근거 문서와 기존 사업 맵 부재", "[DEMO] 공공성과 기업 편익을 분리한 성과지표 미정"],
    nextCandidates: ["[DEMO] 공동활용 안전 데이터셋 실증", "[DEMO] 검사·인증기관 연계 검증", "[DEMO] 민간 매칭형 단계 지원"],
    dataRequests: ["[DEMO] 관련 법령·기본계획의 조문 또는 페이지", "[DEMO] 유사 정부사업 목록과 차별성", "[DEMO] 공공편익·민간편익 산정 근거"],
    confidenceRationale: "[DEMO] 안전이라는 공공 목적은 식별되지만 실제 정책문서가 입력되지 않아 정책 부합성과 추가 지원 필요성은 확인이 더 필요합니다."
  });
  sampleProject.agentResults.challenger = Object.assign(sampleProject.agentResults.challenger, {
    critiques: {
      technology: { verdict: "[DEMO] 핵심 구조는 유망하나 현장 일반화를 입증했다는 판단은 시기상조입니다.", counterArguments: ["[DEMO] 실험실 정확도가 차량·ESS 운용조건에서도 유지된다는 보장이 없습니다.", "[DEMO] 설명 가능성이 실제 안전 의사결정 개선으로 이어지는지는 별도 검증이 필요합니다."], weakEvidence: ["[DEMO] TRL 5 판정의 시험 환경과 판정 근거가 제시되지 않았습니다.", "[DEMO] 신규 화학계 성능을 뒷받침할 외부 검증 자료가 없습니다."], verificationQuestions: ["[DEMO] 독립기관 시험에서 화학계별 오탐·미탐은 얼마입니까?", "[DEMO] 데이터 드리프트 시 성능과 경보 기준은 어떻게 변합니까?"], reversalConditions: ["[DEMO] 다기관 현장시험에서 사전 정의 KPI를 통과하면 회의적 판정을 상향합니다."] },
      industry: { verdict: "[DEMO] 적용처 후보는 있으나 구매 의사와 반복 매출 가능성은 미검증입니다.", counterArguments: ["[DEMO] 안전 문제의 중요성이 곧 유료 솔루션 구매를 뜻하지 않습니다.", "[DEMO] 고객은 신규 SaaS보다 기존 BMS 내재화를 선택할 수 있습니다."], weakEvidence: ["[DEMO] 수요기업 명단·LOI·유료 PoC가 없습니다.", "[DEMO] 가격과 통합비용을 포함한 경제성 비교가 없습니다."], verificationQuestions: ["[DEMO] 누가 어떤 예산으로 구매하며 승인권자는 누구입니까?", "[DEMO] 기존 방식 대비 총소유비용 절감액은 얼마입니까?"], reversalConditions: ["[DEMO] 독립 고객 2곳 이상의 유료 PoC와 갱신 조건이 확인되면 시장성 판정을 상향합니다."] },
      policy: { verdict: "[DEMO] 공공안전 명분만으로 추가 정부 R&D를 정당화하기에는 근거가 부족합니다.", counterArguments: ["[DEMO] 민간 수익이 큰 경우 정부 직접지원보다 규격·데이터 조정이 적합할 수 있습니다.", "[DEMO] 국가전략 연계는 필요조건일 뿐 추가 지원의 충분조건이 아닙니다."], weakEvidence: ["[DEMO] 특정 정책 조문과 시행계획 페이지가 없습니다.", "[DEMO] 기존 사업 중복 및 민간 대체 가능성 분석이 없습니다."], verificationQuestions: ["[DEMO] 해결하려는 시장실패는 무엇이며 수치로 어떻게 관찰됩니까?", "[DEMO] 보조금 외 규제·표준·조달 수단과 비교했습니까?"], reversalConditions: ["[DEMO] 공동 데이터 구축의 시장실패와 순공공편익이 입증되면 정부 개입 판정을 상향합니다."] }
    },
    crossAgentConflicts: ["[DEMO] Technology의 실증 진입 낙관과 Industry의 고객·통합비용 미확인이 충돌합니다.", "[DEMO] Policy의 공공 실증 필요성은 Industry가 제시해야 할 민간 대체 가능성 검증 없이 확정할 수 없습니다."],
    overallAssessment: "[DEMO] 세 영역 모두 다음 단계 후보는 식별했지만, 현장 성능·유료 수요·정부 개입 추가성이라는 서로 다른 게이트를 통과해야 합니다.",
    confidenceRationale: "[DEMO] 비판 논리는 제공된 누락 정보를 직접 반영하므로 방향성 신뢰도는 중간이지만, 실제 반대 증거가 입력되지 않아 결론적 기각에는 부족합니다."
  });
  Object.assign(sampleProject.agentResults.transition, {
    routeCandidates: [
      { route: "실증", rationale: "[DEMO] 현장 일반화와 유료 수요를 동시에 검증해 현재의 두 핵심 불확실성을 줄입니다.", preconditions: ["[DEMO] 재사용 배터리 운영사 데이터 사용 합의", "[DEMO] 오탐·미탐 KPI와 책임 범위 합의"], bottleneck: "[DEMO] 제조사·운영사의 현장 데이터 접근권과 유료 PoC 고객 부재", actions: ["[DEMO] 데이터 제공 범위와 책임을 계약서에 명시", "[DEMO] 화학계별 현장 KPI를 사전 등록", "[DEMO] 독립 고객 2곳에서 유료 PoC 수행"], evidence: ["[DEMO] Technology가 현장 일반화 검증 부족을 지적", "[DEMO] Industry가 유료 고객 근거 부재를 지적"], missingData: ["[DEMO] 고객별 데이터 제공 가능 범위", "[DEMO] PoC 예산과 구매 승인권자"] },
      { route: "기술이전", rationale: "[DEMO] 직접 제품화 역량이 부족할 때 BMS 기업의 통합·판매 역량을 활용할 수 있습니다.", preconditions: ["[DEMO] 이전 대상 특허·소스 범위 확정", "[DEMO] 후보 기업의 통합비용 검토"], bottleneck: "[DEMO] 이전 가능한 지식재산 범위와 도입 기업의 통합비용 미확인", actions: ["[DEMO] 기술·IP 패키지 목록화", "[DEMO] BMS 후보사 기술실사", "[DEMO] 단계별 실시료 조건 협상"], evidence: ["[DEMO] Industry가 BMS 협력 경로를 후보로 제시"], missingData: ["[DEMO] 특허 권리관계", "[DEMO] 후보사의 도입 의향"] },
      { route: "후속 R&D", rationale: "[DEMO] 화학계별 성능이 기준 이하일 때만 모델 일반화 연구를 추가합니다.", preconditions: ["[DEMO] 독립 현장시험에서 사전 KPI 미달", "[DEMO] 실패 원인이 데이터가 아닌 모델 한계로 확인"], bottleneck: "[DEMO] 추가 연구 필요성을 판정할 독립 현장시험 결과 부재", actions: ["[DEMO] 기준모델 대비 교차검증", "[DEMO] 실패 원인 분석", "[DEMO] 연구 범위와 종료조건 재설계"], evidence: ["[DEMO] Technology가 신규 화학계 성능 미확인을 지적"], missingData: ["[DEMO] 화학계별 시험성적서"] }
    ],
    recommendedRoute: "실증"
  });
  Object.assign(sampleProject.agentResults.final, {
    primaryNext: "실증",
    bottleneck: "[DEMO] 제조사·운영사의 현장 데이터 접근권과 유료 PoC 고객 부재",
    bottleneckEvidence: ["[DEMO] 현장 일반화 시험성적서가 제공되지 않았습니다.", "[DEMO] 유료 고객·LOI·구매예산 근거가 제공되지 않았습니다."],
    decision: "[DEMO] 후속 R&D를 바로 확대하기보다 유료 현장 실증으로 성능 일반화와 지불의사를 함께 검증해야 기술이전·민간전환 여부를 판단할 수 있습니다.",
    preconditions: ["[DEMO] 데이터 사용권과 사고 책임 범위 계약", "[DEMO] 화학계별 오탐·미탐 KPI 사전 확정", "[DEMO] 독립 고객 2곳의 PoC 예산 확인"],
    executionPlan: [
      { action: "[DEMO] 운영사와 데이터·책임 계약 체결", owner: "[DEMO] 주관기관 사업책임자", time: "[DEMO] 3개월 이내", KPI: "[DEMO] 사용 가능한 현장 데이터 계약 1건 이상" },
      { action: "[DEMO] 화학계별 현장 검증 프로토콜 확정", owner: "[DEMO] 주관기관 기술책임자와 독립 시험기관", time: "[DEMO] 4개월 이내", KPI: "[DEMO] 오탐·미탐·가용성 KPI 사전 등록" },
      { action: "[DEMO] 독립 고객 유료 PoC 수행", owner: "[DEMO] 수요기업과 주관기관", time: "[DEMO] 6개월 이내", KPI: "[DEMO] 유료 PoC 2곳 및 KPI 충족 결과" }
    ],
    rejectedAlternatives: [{ route: "후속 R&D", reason: "[DEMO] 현장 실패 원인이 모델 한계인지 아직 확인되지 않아 연구 확대가 성급합니다." }, { route: "기술이전", reason: "[DEMO] 이전 가능한 IP 범위와 도입기업의 통합 의향이 확인되지 않았습니다." }],
    confidence: 72,
    confidenceRationale: "[DEMO] 세 진단이 실증 게이트의 필요성에는 수렴하지만 계약·시험 원자료가 없어 신뢰도는 중간 수준입니다.",
    reassessmentTriggers: ["[DEMO] 3개월 내 현장 데이터 계약 미체결", "[DEMO] 독립시험 KPI 미달", "[DEMO] 유료 PoC 고객 2곳 미확보"]
  });
  Object.values(sampleProject.agentResults).forEach((result) => {
    for (const field of ["summary", "insight"]) if (result[field] && !result[field].startsWith("[DEMO]")) result[field] = `[DEMO] ${result[field]}`;
    for (const field of ["strengths", "risks"]) result[field] = safeArrayForDemo(result[field]).map((item) => item.startsWith("[DEMO]") ? item : `[DEMO] ${item}`);
  });

  function safeArrayForDemo(value) { return Array.isArray(value) ? value : []; }

  const analysisAgents = [
    { key: "technology", name: "Technology", label: "기술 분석", icon: "T", iconClass: "tech", message: "핵심 기술성과 기술성숙도를 점검하고 있습니다." },
    { key: "industry", name: "Industry", label: "산업 분석", icon: "I", iconClass: "industry", message: "시장성 및 산업 파급효과를 분석하고 있습니다." },
    { key: "policy", name: "Policy", label: "정책 분석", icon: "P", iconClass: "policy", message: "정책 부합성과 공공 가치를 검토하고 있습니다." },
    { key: "challenger", name: "Challenger", label: "반론 검증", icon: "C", iconClass: "challenge", message: "핵심 가정과 잠재 위험을 검증하고 있습니다." },
    { key: "transition", name: "Transition", label: "전환 설계", icon: "R", iconClass: "transition", message: "실행 가능한 전환 경로를 설계하고 있습니다." },
    { key: "final", name: "NEXT Synthesizer", label: "종합 분석", icon: "N", iconClass: "final", message: "분석 결과를 종합해 최종 제안을 만들고 있습니다." }
  ];

  const agentGuardrails = {
    technology: {
      role: "해당 R&D 기술의 현재 기술성숙도와 기술적 후속 필요성을 판단합니다.",
      inputScope: "과제 공개정보, 논문, 특허, 기술로드맵",
      criteria: ["기술성숙도(TRL)", "핵심기술 확보 수준", "목표 대비 성능달성도", "미해결 기술문제·기술적 병목", "경쟁기술 대비 우위·열위", "기술발전 속도·대체기술 등장 가능성", "기술 통합·확장 가능성", "실험실 수준과 실제환경 적용 간 격차"],
      prohibited: "시장성이나 정책 필요성을 최종 판단하지 않음",
      outputs: ["판정", "핵심 발견 3~6", "근거 3~6", "불확실성 3~5", "병목", "후보", "데이터 요청", "신뢰도 근거"]
    },
    industry: {
      role: "민간 시장과 산업 수요 관점에서 후속 지원 필요성을 판단합니다.",
      inputScope: "기업투자, 시장동향, 경쟁제품, 수요정보",
      criteria: ["시장 형성 수준", "실제 수요기업 존재 여부", "민간투자 규모·증가 추세", "상용제품·서비스 존재 여부", "경쟁기업 수", "산업 내 기술채택 속도", "고객의 지불의사", "공급망 형성 수준", "시장진입장벽", "해외기업 의존도", "국내기업 경쟁력", "민간의 자체 기술개발 지속 가능성"],
      prohibited: "시장성숙도·민간투자·수요기업 존재 여부를 독자적으로 확정하지 않음",
      outputs: ["판정", "핵심 발견 3~6", "근거 3~6", "불확실성 3~5", "병목", "후보", "데이터 요청", "신뢰도 근거"]
    },
    policy: {
      role: "해당 R&D 기술·성과에 대해 국가정책, 정부 역할, 공공적 필요성 측면에서 추가적인 정부 R&D 개입이 필요한지 판단합니다.",
      inputScope: "국가전략, 정부 정책·계획, 부처별 시행·계획, 예산방향, 기존·신규 R&D 사업, 법·제도 변화, 해외 주요국 정책동향",
      criteria: ["국가전략과의 부합성", "정부개입 필요성", "시장실패 가능성", "전략기술 해당 여부", "공공성·사회적 파급효과", "기존 정부지원과의 중복 가능성", "정책환경 변화"],
      prohibited: "기술성숙도나 시장규모를 독자적으로 확정하지 않음. 국가전략 포함만으로 추가 정부지원이 필요하다고 결론내리지 않음. Technology·Industry 판단 없이 후속 R&D 여부를 단독 결정하지 않음",
      outputs: ["판정", "핵심 발견 3~6", "근거 3~6", "불확실성 3~5", "병목", "후보", "데이터 요청", "신뢰도 근거"]
    },
    challenger: {
      role: "Technology·Industry·Policy Agent가 제시한 판단과 근거를 비판적으로 검토하고 논리적 비약·근거 부족·상충되는 주장·확증편향을 찾아 최종 판단의 신뢰도를 높입니다.",
      inputScope: "Technology·Industry·Policy 분석결과, 각 Agent가 제시한 근거자료와 출처",
      criteria: ["주장과 근거의 연결성", "Agent 간 판단 불일치", "근거의 최신성·신뢰성", "반대근거 존재 여부", "인과관계와 단순 상관관계의 혼동", "정부지원 필요성에 대한 논리적 비약", "과도한 낙관·비관 판단"],
      prohibited: "자신의 선호에 따라 새로운 결론을 임의로 제시하지 않음. 반대를 위한 반대를 하지 않음. 근거 없이 다른 Agent의 판단을 부정하지 않음. 최종 NEXT를 단독 결정하지 않음",
      outputs: ["기술·산업·정책별 판정", "도메인별 반론·약한 근거", "검증 질문", "판단 반전 조건", "Agent 간 충돌", "종합 평가", "신뢰도 근거"]
    },
    transition: {
      role: "Technology·Industry·Policy 진단과 Challenger 검증 결과를 바탕으로 현실적인 후속 전환 후보 경로 2~3개와 각 경로의 선결조건, 병목, 추가 필요 정보를 도출합니다.",
      inputScope: "Technology·Industry·Policy Agent 결과, Challenger 결과, 공개된 기술이전·실증·표준화·사업화·후속 R&D 사례, 관련 지원사업 및 제도정보",
      criteria: ["기술성숙도와 요구 TRL 간 적합성", "실제 수요 존재 여부", "민간의 후속투자 가능성", "실증 필요성", "표준·인증 필요성", "기술이전 가능조건", "후속 R&D 필요성", "정책수단 간 적합성", "다음 단계 이동을 위한 핵심 병목"],
      prohibited: "사업을 직접 실행하거나 특정 기업으로의 기술이전을 결정하지 않음. 새로운 기술·시장·정책 판단을 임의로 만들지 않음. 하나의 경로를 강제하지 않음. 근거가 부족하면 반드시 '추가 판단 필요'라고 명시함",
      outputs: ["후보 경로 2~3개", "경로별 이유·선결조건·병목", "구체 행동·근거·누락 데이터", "추천 경로"]
    },
    final: {
      role: "Transition이 도출한 후보 경로 중 하나의 주요 NEXT를 선정하고, 1~2개의 대안과 선정 이유, 미선정 경로의 제외 이유, 신뢰도, 다음 행동을 제시합니다.",
      inputScope: "Transition의 후보 경로·선결조건·병목·추가 필요 정보, Technology·Industry·Policy의 진단 근거, Challenger의 반론·검증 조건",
      criteria: ["핵심 병목 해결 적합성", "선행조건 충족도", "전환 준비도", "Agent 간 판단 일관성", "Challenger 검증결과", "근거 신뢰도", "경로 간 순차·병행 관계"],
      prohibited: "근거를 임의로 만들지 않음. 점수만으로 기계적으로 선정하지 않음. Challenger의 반론이나 충족되지 않은 선결조건을 무시하지 않음. 근거가 부족한데도 결정을 강제하지 않음",
      outputs: ["주요 NEXT·구체 병목·근거", "선택 이유·선결조건", "담당/시점/KPI 실행계획", "미선정 경로와 이유", "신뢰도·재평가 조건"]
    }
  };

  const ANALYSIS_TIMINGS = { diagnosis: 900, challenger: 900, transition: 1100, synthesizer: 1000, handoff: 180 };

  const State = {
    projects: [], currentProjectId: null, currentTab: "technology",
    load() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        this.projects = Array.isArray(saved) && saved.length ? saved : [sampleProject];
      } catch (_) { this.projects = [sampleProject]; }
      this.projects.forEach((project) => {
        ProjectModel.migrateProject(project);
        project.openaiKeyConfigured = Boolean(project.openaiKeyConfigured ?? project.apiKeyConfigured);
        project.ntisConfigured = Boolean(project.ntisConfigured);
        delete project.apiKeyConfigured;
        sanitizeProjectCredentials(project);
      });
      this.save();
    },
    save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.projects)); },
    project(id) { return this.projects.find((project) => project.id === id); }
  };

  const AnalysisEngine = {
    createProject(form, candidate, report, openaiKeyConfigured = false, ntisConfigured = false, ntisLookup = null) {
      const project = JSON.parse(JSON.stringify(sampleProject));
      const id = `rnd-${Date.now()}`;
      project.id = id;
      project.name = redactCredentialText(form.name);
      project.field = redactCredentialText(form.field);
      project.organization = redactCredentialText(form.organization);
      project.projectId = redactCredentialText(form.id || form.projectId || "");
      if (candidate) project.ntisReference = {
          id: redactCredentialText(candidate.id), title: redactCredentialText(candidate.title),
          org: redactCredentialText(candidate.org), period: redactCredentialText(candidate.period),
          similarity: Number.isFinite(candidate.similarity) ? candidate.similarity : null
        };
      else delete project.ntisReference;
      if (project.ntisReference?.id) project.ntisId = project.ntisReference.id;
      else delete project.ntisId;
      project.ntisAchievements = Array.isArray(ntisLookup?.results) ? JSON.parse(JSON.stringify(ntisLookup.results)) : [];
      project.ntisSource = ntisLookup?.source && typeof ntisLookup.source === "object" ? JSON.parse(JSON.stringify(ntisLookup.source)) : null;
      project.ntisCounts = ntisLookup?.counts && typeof ntisLookup.counts === "object" ? { ...ntisLookup.counts } : {};
      project.ntisWarnings = Array.isArray(ntisLookup?.warnings) ? ntisLookup.warnings.slice(0, 6).map((item) => redactCredentialText(item)) : [];
      project.period = "2026.09 – 2028.08";
      project.budget = "검토 중";
      project.nextType = project.agentResults.final.primaryNext;
      project.status = "검토 대기";
      project.createdAt = new Date().toISOString();
      project.bottleneck = project.agentResults.final.bottleneck;
      project.analysisStage = "diagnosis-waiting";
      project.openaiKeyConfigured = Boolean(openaiKeyConfigured);
      project.ntisConfigured = Boolean(ntisConfigured);
      if (report) project.report = JSON.parse(JSON.stringify(report));
      const reportContent = report ? {
          name: report.name,
          size: report.size,
          type: report.type,
          extension: report.extension,
          lastModified: report.lastModified,
          extractionStatus: report.extractionStatus,
          parser: report.parser || "browser",
          extractedLength: report.extractedLength || 0,
          truncated: Boolean(report.truncated),
          content: String(report.parsedMarkdown || report.extractedText || "").slice(0, REPORT_TEXT_LIMIT),
          structured: report.parsedJson || null,
          warnings: Array.isArray(report.warnings) ? report.warnings : []
        } : null;
      project.analysisInput = ProjectModel.buildAnalysisInput(
        { id: project.projectId, name: project.name, field: project.field, organization: project.organization },
        project.ntisReference,
        reportContent,
        project.ntisAchievements,
        project.ntisSource
      );
      project.reportSourceMode = reportSourceMode(project);
      const domain = form.field;
      Object.values(project.agentResults).forEach((result) => {
        result.summary = `${domain} 분야의 수동 입력 대상과 확보된 참고 근거를 바탕으로 생성한 파일럿 분석입니다. ${result.summary}`;
      });
      project.agentResults.final.insight = `${project.nextType} 권고: ${project.agentResults.final.bottleneck}`;
      return sanitizeProjectCredentials(project);
    }
  };
  // Deterministic Node regression harness; contains no credentials or browser state.
  if (typeof window !== "undefined") window.RndNextTest = { AnalysisEngine };

  const els = {};
  let toastTimer;
  let pendingReport = null;
  let pendingReportRead = Promise.resolve(null);
  let reportSelectionToken = 0;
  const AnalysisFlow = {
    projectId: null,
    statuses: [],
    timer: null,
    running: false,
    stop() {
      clearTimeout(this.timer);
      this.timer = null;
      this.running = false;
    },
    start(projectId) {
      this.stop();
      this.projectId = projectId;
      this.statuses = analysisAgents.map(() => "waiting");
      navigate("analysis", projectId);
      this.resume();
    },
    setStage(stage) {
      const project = State.project(this.projectId);
      if (!project) return;
      project.analysisStage = stage;
      State.save();
      this.syncStatuses(stage);
      renderAnalysis();
    },
    syncStatuses(stage) {
      const statuses = analysisAgents.map(() => "waiting");
      if (stage === "real-running") {
        const project = State.project(this.projectId);
        const completed = new Set(Array.isArray(project?.realCompletedAgents) ? project.realCompletedAgents : []);
        analysisAgents.forEach((agent, index) => { if (completed.has(agent.key)) statuses[index] = "complete"; });
        const pending = (Array.isArray(project?.runningAgents) ? project.runningAgents : []).filter((key) => !completed.has(key));
        const parallel = pending.filter((key) => ["technology", "industry", "policy"].includes(key));
        if (parallel.length) parallel.forEach((key) => { statuses[analysisAgents.findIndex((agent) => agent.key === key)] = "running"; });
        else {
          const runningIndex = analysisAgents.findIndex((agent) => agent.key === pending[0]);
          if (runningIndex >= 0) statuses[runningIndex] = "running";
        }
      }
      if (["diagnosis-running"].includes(stage)) [0, 1, 2].forEach((index) => { statuses[index] = "running"; });
      if (["challenger-waiting", "challenger-running", "transition-ready", "transition-running", "synthesis-ready", "synthesis-running", "complete"].includes(stage)) [0, 1, 2].forEach((index) => { statuses[index] = "complete"; });
      if (stage === "challenger-running") statuses[3] = "running";
      if (["transition-ready", "transition-running", "synthesis-ready", "synthesis-running", "complete"].includes(stage)) statuses[3] = "complete";
      if (stage === "transition-running") statuses[4] = "running";
      if (["synthesis-ready", "synthesis-running", "complete"].includes(stage)) statuses[4] = "complete";
      if (stage === "synthesis-running") statuses[5] = "running";
      if (stage === "complete") statuses[5] = "complete";
      if (stage === "complete" && ["openai", "openai-pending", "openai-partial"].includes(State.project(this.projectId)?.analysisMode)) {
        const completed = new Set(State.project(this.projectId)?.realCompletedAgents || []);
        analysisAgents.forEach((agent, index) => { statuses[index] = completed.has(agent.key) ? "complete" : "waiting"; });
      }
      if (stage === "real-failed") {
        const project = State.project(this.projectId);
        const completed = new Set(Array.isArray(project?.realCompletedAgents) ? project.realCompletedAgents : []);
        analysisAgents.forEach((agent, index) => { if (completed.has(agent.key)) statuses[index] = "complete"; });
      }
      this.statuses = statuses;
    },
    schedule(callback, duration) {
      clearTimeout(this.timer);
      this.running = true;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (location.hash.replace(/^#/, "").split("/")[0] !== "analysis") return this.stop();
        callback.call(this);
      }, duration);
    },
    resume() {
      const project = State.project(this.projectId || State.currentProjectId);
      if (!project) return;
      this.projectId = project.id;
      const stage = project.analysisStage || "complete";
      this.syncStatuses(stage);
      renderAnalysis();
      if (stage === "real-running") return;
      if (stage === "diagnosis-waiting") this.schedule(() => {
        this.setStage("diagnosis-running");
        this.schedule(() => {
          this.setStage("challenger-waiting");
          this.schedule(() => {
            this.setStage("challenger-running");
            this.schedule(() => {
              this.running = false;
              this.setStage("transition-ready");
              resetNewForm();
              showToast("Challenger 검증이 완료되었습니다. Transition을 실행할 수 있습니다.");
            }, ANALYSIS_TIMINGS.challenger);
          }, ANALYSIS_TIMINGS.handoff);
        }, ANALYSIS_TIMINGS.diagnosis);
      }, ANALYSIS_TIMINGS.handoff);
      if (stage === "diagnosis-running") this.schedule(() => {
        this.setStage("challenger-running");
        this.schedule(() => { this.running = false; this.setStage("transition-ready"); }, ANALYSIS_TIMINGS.challenger);
      }, ANALYSIS_TIMINGS.diagnosis);
      if (stage === "challenger-waiting") this.schedule(() => {
        this.setStage("challenger-running");
        this.schedule(() => { this.running = false; this.setStage("transition-ready"); }, ANALYSIS_TIMINGS.challenger);
      }, ANALYSIS_TIMINGS.handoff);
      if (stage === "challenger-running") this.schedule(() => { this.running = false; this.setStage("transition-ready"); }, ANALYSIS_TIMINGS.challenger);
      if (stage === "transition-running") this.schedule(() => { this.running = false; this.setStage("synthesis-ready"); }, ANALYSIS_TIMINGS.transition);
      if (stage === "synthesis-running") this.schedule(() => { this.running = false; this.setStage("complete"); }, ANALYSIS_TIMINGS.synthesizer);
    },
    runTransition() {
      const project = State.project(this.projectId);
      if (!project || project.analysisStage !== "transition-ready") return;
      this.setStage("transition-running");
      this.schedule(() => {
        this.running = false;
        this.setStage("synthesis-ready");
        showToast("Transition 경로설계가 완료되었습니다.");
      }, ANALYSIS_TIMINGS.transition);
    },
    runSynthesizer() {
      const project = State.project(this.projectId);
      if (!project || project.analysisStage !== "synthesis-ready") return;
      this.setStage("synthesis-running");
      this.schedule(() => {
        this.running = false;
        this.setStage("complete");
        showToast("NEXT Synthesizer 최종 추천이 생성되었습니다.");
      }, ANALYSIS_TIMINGS.synthesizer);
    }
  };

  function cacheElements() {
    ["page-title", "nav-project-count", "kpi-grid", "distribution", "bottleneck-list", "recent-projects", "analysis-form", "search-button", "project-search", "status-filter", "projects-list", "analysis-content", "detail-content", "sidebar", "sidebar-overlay", "menu-button", "toast", "final-report", "selected-report", "openai-api-key", "toggle-openai-key", "openai-api-key-status", "ntis-connection-badge", "ntis-connection-status"].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function renderNtisConnectionStatus() {
    els["ntis-connection-badge"].textContent = NTIS_CONFIGURED ? "서버 설정됨" : "미설정";
    els["ntis-connection-badge"].classList.toggle("is-configured", NTIS_CONFIGURED);
    els["ntis-connection-status"].classList.toggle("is-configured", NTIS_CONFIGURED);
    els["ntis-connection-status"].querySelector("span").innerHTML = NTIS_CONFIGURED
      ? "연결 준비됨 · 분석 시작 전에 논문·특허·연구보고서를 자동 조회합니다"
      : "서버 자격증명 없음 · <strong>NTIS 근거 없이 분석을 계속합니다</strong>";
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function renderGuardrails(key, open = false) {
    const guardrail = agentGuardrails[key];
    if (!guardrail) return `<div class="guardrail-pending"><strong>분석 기준</strong><span>정의 대기 · 역할·입력·판단 기준·금지 행동·출력이 아직 정의되지 않았습니다.</span></div>`;
    const list = (items) => items.map((item) => `<li>${escapeHTML(item)}</li>`).join("");
    return `<details class="guardrail-panel" ${open ? "open" : ""}>
      <summary><span>분석 기준</span><small>역할·입력·판단 기준·금지 행동·출력</small></summary>
      <dl class="guardrail-grid">
        <div><dt>역할</dt><dd>${escapeHTML(guardrail.role)}</dd></div>
        <div><dt>입력</dt><dd>${escapeHTML(guardrail.inputScope)}</dd></div>
        <div><dt>판단 기준</dt><dd><ul>${list(guardrail.criteria)}</ul></dd></div>
        <div class="guardrail-prohibited"><dt>금지 행동</dt><dd>${escapeHTML(guardrail.prohibited)}</dd></div>
        <div><dt>출력</dt><dd><ul class="guardrail-fields">${list(guardrail.outputs)}</ul></dd></div>
      </dl>
    </details>`;
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 1) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** index);
    return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
  }

  function reportSourceMode(project) {
    const sources = ["분석 대상"];
    if (Array.isArray(project.ntisAchievements) && project.ntisAchievements.length) sources.push("NTIS 성과 근거");
    else if (project.ntisReference?.id) sources.push("기존 NTIS 참고자료");
    if (project.report) sources.push("종료보고서");
    return `${sources.join("·")} 기반`;
  }

  function ntisStatusText(project) {
    const status = project.ntisSource?.status;
    const count = Array.isArray(project.ntisAchievements) ? project.ntisAchievements.length : 0;
    if (status === "available") return `조회 완료 · 성과 ${count}건`;
    if (status === "loading") return "논문·특허·연구보고서 조회 중";
    if (status === "partial") return `일부 조회 완료 · 성과 ${count}건 · 일부 컬렉션 실패`;
    if (status === "empty") return "조회 완료 · 검색 결과 없음";
    if (status === "not-configured") return "서버 키 미설정 · 성과 근거 없이 계속";
    if (status === "unavailable" || status === "network-error") return "NTIS 조회 불가 · 성과 근거 없이 계속";
    if (status === "skipped") return "조회 건너뜀";
    return project.ntisReference?.id ? "이전 저장 프로젝트의 참고자료" : "조회 상태 정보 없음";
  }

  function renderNtisEvidence(project) {
    const achievements = Array.isArray(project.ntisAchievements) ? project.ntisAchievements : [];
    const reference = project.ntisReference || {};
    if (project.ntisSource?.status === "loading") return `<section class="report-summary panel"><div class="report-summary-icon"><i class="agent-spinner"></i></div><div><p class="section-kicker">NTIS R&amp;D 성과 · 참고 근거</p><h2>성과 근거를 자동 조회하고 있습니다</h2><p>논문·특허·연구보고서 조회가 끝나면 에이전트 분석을 시작합니다.</p></div><span class="source-mode">조회 중</span></section>`;
    if (achievements.length) {
      const labels = { paper: "논문", patent: "특허", researchReport: "연구보고서" };
      const items = achievements.slice(0, 6).map((item) => `<li><strong>${escapeHTML(labels[item.type] || item.collection || "성과")}</strong><span>${escapeHTML(item.title || item.id || "제목 정보 없음")}</span><small>${escapeHTML([item.organization, item.year, item.projectId].filter(Boolean).join(" · ") || "추가 메타데이터 없음")}</small></li>`).join("");
      return `<section class="report-summary panel ntis-achievements"><div class="report-summary-icon">N</div><div class="report-summary-copy"><p class="section-kicker">NTIS R&amp;D 성과 · 참고 근거 (분석 대상 아님)</p><h2>자동 조회 성과 ${achievements.length}건</h2><p>${escapeHTML(ntisStatusText(project))}</p><ul class="ntis-evidence-list">${items}</ul>${achievements.length > 6 ? `<small>외 ${achievements.length - 6}건은 분석 입력에 포함되었습니다.</small>` : ""}${project.ntisWarnings?.length ? `<p class="source-warning">${escapeHTML(project.ntisWarnings.join(" · "))}</p>` : ""}</div><span class="source-mode">참고 근거</span></section>`;
    }
    if (!reference.id) return `<section class="report-summary panel is-empty"><div class="report-summary-icon">N</div><div><p class="section-kicker">NTIS R&amp;D 성과 · 참고 근거</p><h2>자동 조회 성과 없음</h2><p>${escapeHTML(ntisStatusText(project))}. 수동 입력 대상${project.report ? "과 종료보고서" : ""}만으로 분석을 계속했습니다.</p>${project.ntisWarnings?.length ? `<p class="source-warning">${escapeHTML(project.ntisWarnings.join(" · "))}</p>` : ""}</div><span class="source-mode">${escapeHTML(project.ntisSource?.status || "없음")}</span></section>`;
    const similarity = Number.isFinite(reference.similarity) ? ` · 유사도 ${reference.similarity}%` : "";
    return `<section class="report-summary panel"><div class="report-summary-icon">N</div><div class="report-summary-copy"><p class="section-kicker">기존 NTIS 참고자료 · 분석 대상 아님</p><h2>${escapeHTML(reference.title || reference.id)}</h2><p>${escapeHTML(reference.org || "기관 정보 없음")} · ${escapeHTML(reference.period || "기간 정보 없음")} · ${escapeHTML(reference.id)}${similarity}</p><small>이전 버전에서 저장된 프로젝트와의 호환을 위해 표시합니다.</small></div><span class="source-mode">기존 참고자료</span></section>`;
  }

  function extractionLabel(report) {
    if (report.extractionStatus === "available" && report.parser === "kordoc") {
      const suffix = report.truncated ? " · 텍스트 일부 저장" : Array.isArray(report.warnings) && report.warnings.length ? ` · 경고 ${report.warnings.length}건` : "";
      return `kordoc 파싱 완료${suffix}`;
    }
    if (report.extractionStatus === "available") return report.truncated ? `텍스트 ${Number(report.extractedLength || 0).toLocaleString("ko-KR")}자 저장 (원문 일부)` : `텍스트 ${Number(report.extractedLength || 0).toLocaleString("ko-KR")}자 추출`;
    if (report.extractionStatus === "failed") return `파싱 실패${report.warnings?.[0] ? ` · ${report.warnings[0]}` : " · 메타데이터만 사용"}`;
    if (report.extractionStatus === "pending") return "백엔드 파싱 대기 · 메타데이터만 사용";
    return "지원되는 텍스트 추출 경로 없음 · 메타데이터만 사용";
  }

  function renderReportSummary(project, detail = false) {
    const report = project.report;
    if (!report) return `<section class="report-summary panel is-empty"><div class="report-summary-icon">◇</div><div><p class="section-kicker">첨부자료</p><h2>종료보고서 없음</h2><p>첨부 없이 수동 입력 대상과 조회된 NTIS 성과 근거만 사용했습니다.</p></div><span class="source-mode">${reportSourceMode(project)}</span></section>`;
    const reportText = report.parsedMarkdown || report.extractedText || "";
    const excerpt = report.extractionStatus === "available" ? reportText.slice(0, detail ? 900 : 360) : "";
    return `<section class="report-summary panel"><div class="report-summary-icon">▧</div><div class="report-summary-copy"><p class="section-kicker">첨부자료</p><h2>${escapeHTML(report.name)}</h2><p>${escapeHTML(formatBytes(report.size))} · ${escapeHTML((report.extension || "파일").toUpperCase())} · ${escapeHTML(extractionLabel(report))}</p>${excerpt ? `<details class="report-excerpt" ${detail ? "open" : ""}><summary>추출 텍스트 미리보기</summary><pre>${escapeHTML(excerpt)}${reportText.length > excerpt.length ? "\n…" : ""}</pre></details>` : ""}</div><span class="source-mode">${reportSourceMode(project)}</span></section>`;
  }

  function statusClass(status) {
    return status === "승인" ? "approved" : status === "수정요청" ? "revision" : status === "보류" ? "hold" : "";
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
  }

  function closeSidebar() {
    els.sidebar.classList.remove("is-open");
    els["sidebar-overlay"].classList.remove("is-open");
    els["menu-button"].setAttribute("aria-expanded", "false");
  }

  function navigate(route, id) {
    const safeRoute = ["dashboard", "new", "projects", "analysis", "detail"].includes(route) ? route : "dashboard";
    if (["analysis", "detail"].includes(safeRoute) && id) State.currentProjectId = id;
    if (safeRoute !== "analysis" && AnalysisFlow.timer) AnalysisFlow.stop();
    location.hash = ["analysis", "detail"].includes(safeRoute) ? `#${safeRoute}/${State.currentProjectId || ""}` : `#${safeRoute}`;
    renderRoute();
  }

  function renderRoute() {
    const parts = location.hash.replace(/^#/, "").split("/");
    let route = parts[0] || "dashboard";
    if (!["dashboard", "new", "projects", "analysis", "detail"].includes(route)) route = "dashboard";
    if (["analysis", "detail"].includes(route)) {
      State.currentProjectId = parts[1] || State.currentProjectId || State.projects[0]?.id;
      if (!State.project(State.currentProjectId)) route = "projects";
    }
    if (route !== "analysis" && AnalysisFlow.timer) AnalysisFlow.stop();
    document.querySelectorAll("[data-view]").forEach((view) => { view.hidden = view.dataset.view !== route; });
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.route === route || (["analysis", "detail"].includes(route) && item.dataset.route === "projects")));
    const titles = { dashboard: "종합 대시보드", new: "새 과제 분석", projects: "과제 목록", analysis: "에이전트 분석 진행", detail: "분석 결과" };
    els["page-title"].textContent = titles[route];
    if (route === "dashboard") renderDashboard();
    if (route === "projects") renderProjects();
    if (route === "analysis") {
      if (AnalysisFlow.projectId !== State.currentProjectId) {
        AnalysisFlow.stop();
        AnalysisFlow.projectId = State.currentProjectId;
        AnalysisFlow.resume();
      } else if (!AnalysisFlow.running) AnalysisFlow.resume();
      else renderAnalysis();
    }
    if (route === "detail") renderDetail();
    closeSidebar();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderDashboard() {
    const count = State.projects.length;
    const approved = State.projects.filter((p) => p.status === "승인").length;
    const avgScore = count ? Math.round(State.projects.reduce((sum, p) => sum + (p.agentResults?.final?.score || 0), 0) / count) : 0;
    const pending = State.projects.filter((p) => p.status === "검토 대기").length;
    const kpis = [
      { label: "전체 분석 과제", value: count, unit: "건", icon: "▤", color: "#3767e8", soft: "#eef3ff" },
      { label: "평균 NEXT 점수", value: avgScore, unit: "/ 100", icon: "N", color: "#7c5ce4", soft: "#f1edff" },
      { label: "승인 과제", value: approved, unit: "건", icon: "✓", color: "#16a779", soft: "#eaf9f4" },
      { label: "검토 대기", value: pending, unit: "건", icon: "…", color: "#e59b2f", soft: "#fff7e8" }
    ];
    els["kpi-grid"].innerHTML = kpis.map((kpi) => `<article class="kpi-card" style="--accent:${kpi.color};--accent-soft:${kpi.soft}"><div class="kpi-top"><span>${kpi.label}</span><span class="kpi-icon">${kpi.icon}</span></div><div class="kpi-value">${kpi.value}<small>${kpi.unit}</small></div></article>`).join("");

    const typeCounts = Object.fromEntries(Object.keys(COLORS).map((type) => [type, State.projects.filter((p) => p.nextType === type).length]));
    const max = Math.max(...Object.values(typeCounts), 1);
    els.distribution.innerHTML = Object.entries(typeCounts).map(([type, value]) => `<div class="distribution-row"><div class="distribution-label" style="--bar:${COLORS[type]}"><span></span>${type}</div><div class="bar-track"><div class="bar-fill" style="--bar:${COLORS[type]};--width:${(value / max) * 100}%"></div></div><div class="distribution-count">${value}</div></div>`).join("");

    const bottlenecks = {};
    State.projects.forEach((p) => { bottlenecks[p.bottleneck || "추가 검토 필요"] = (bottlenecks[p.bottleneck || "추가 검토 필요"] || 0) + 1; });
    const sorted = Object.entries(bottlenecks).sort((a, b) => b[1] - a[1]).slice(0, 3);
    els["bottleneck-list"].innerHTML = sorted.length ? sorted.map(([name, value], index) => `<div class="bottleneck-card"><span class="bottleneck-rank">0${index + 1}</span><p>${escapeHTML(name)}<small>관련 과제의 핵심 저해 요인</small></p><strong>${value}건</strong></div>`).join("") : emptyState("표시할 병목이 없습니다", "과제를 등록하면 주요 병목을 집계합니다.");

    els["recent-projects"].innerHTML = State.projects.length ? [...State.projects].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 3).map(projectRow).join("") : emptyState("아직 분석 과제가 없습니다", "첫 과제를 등록해 분석을 시작하세요.");
    els["nav-project-count"].textContent = count;
  }

  function projectRow(project) {
    return `<article class="project-row"><div class="project-name"><strong>${escapeHTML(project.name)}</strong><small>${escapeHTML(project.organization)} · ${escapeHTML(project.field)}</small></div><div class="project-meta"><small>NEXT 유형</small><span class="type-badge" data-next-type="${escapeHTML(project.nextType)}">${escapeHTML(project.nextType)}</span></div><div class="project-meta"><small>종합 점수</small><strong>${project.agentResults?.final?.score || "-"} / 100</strong></div><div><span class="status-badge ${statusClass(project.status)}">${escapeHTML(project.status)}</span></div><button class="row-action" type="button" data-open-project="${escapeHTML(project.id)}">워크스페이스 →</button></article>`;
  }

  function emptyState(title, message) {
    return `<div class="empty-state"><span>◇</span><h3>${escapeHTML(title)}</h3><p>${escapeHTML(message)}</p></div>`;
  }

  async function lookupNtisAchievements(project) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch("/api/ntis/achievements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.warnings?.[0] || `HTTP ${response.status}`);
      return {
        results: Array.isArray(payload.results) ? payload.results : [],
        counts: payload.counts && typeof payload.counts === "object" ? payload.counts : {},
        warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
        source: payload.source && typeof payload.source === "object" ? payload.source : { provider: "NTIS", status: "unavailable" }
      };
    } catch (error) {
      const message = error?.name === "AbortError" ? "응답 시간 초과(30초)" : String(error?.message || "연결할 수 없음");
      return { results: [], counts: {}, warnings: [`NTIS 자동 조회 실패: ${message.slice(0, 180)}. 성과 근거 없이 분석을 계속합니다.`], source: { provider: "NTIS", endpoint: "natRnDAllSearch", status: "network-error", queriedAt: new Date().toISOString() } };
    } finally {
      clearTimeout(timeout);
    }
  }

  function clearReportSelection() {
    reportSelectionToken += 1;
    pendingReport = null;
    pendingReportRead = Promise.resolve(null);
    els["final-report"].value = "";
    els["selected-report"].hidden = true;
    els["selected-report"].innerHTML = "";
  }

  function updateOpenAIKeyStatus() {
    const configured = Boolean(els["openai-api-key"].value.trim());
    els["openai-api-key-status"].classList.toggle("is-configured", configured);
    els["openai-api-key-status"].querySelector("span").innerHTML = configured
      ? "이번 실행 승인됨 · Technology부터 NEXT Synthesizer까지 모두 사용 가능"
      : "키 미입력 · <strong>Mock 분석에서는 불필요, 실제 에이전트 모드에서는 필수</strong>";
  }

  function clearOpenAIKeyInput() {
    els["openai-api-key"].value = "";
    els["openai-api-key"].type = "password";
    els["toggle-openai-key"].textContent = "보기";
    els["toggle-openai-key"].setAttribute("aria-label", "OpenAI API Key 표시");
    els["toggle-openai-key"].setAttribute("aria-pressed", "false");
    updateOpenAIKeyStatus();
  }

  function toggleOpenAIKeyVisibility() {
    const revealing = els["openai-api-key"].type === "password";
    els["openai-api-key"].type = revealing ? "text" : "password";
    els["toggle-openai-key"].textContent = revealing ? "숨기기" : "보기";
    els["toggle-openai-key"].setAttribute("aria-label", revealing ? "OpenAI API Key 숨기기" : "OpenAI API Key 표시");
    els["toggle-openai-key"].setAttribute("aria-pressed", String(revealing));
    els["openai-api-key"].focus();
  }

  function renderSelectedReport() {
    if (!pendingReport) return clearReportSelection();
    const status = pendingReport.extractionStatus === "reading" ? "텍스트를 읽는 중…" : pendingReport.extractionStatus === "parsing" ? "kordoc 백엔드로 파싱 중…" : extractionLabel(pendingReport);
    els["selected-report"].hidden = false;
    els["selected-report"].innerHTML = `<span class="selected-file-icon">▧</span><div><strong>${escapeHTML(pendingReport.name)}</strong><small>${escapeHTML(formatBytes(pendingReport.size))} · ${escapeHTML(status)}</small></div><button type="button" class="remove-report" data-remove-report aria-label="${escapeHTML(pendingReport.name)} 첨부 제거">제거</button>`;
  }

  function handleReportSelection() {
    const file = els["final-report"].files?.[0];
    if (!file) return clearReportSelection();
    const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
    if (!ALLOWED_REPORT_EXTENSIONS.has(extension)) {
      clearReportSelection();
      showToast("지원하지 않는 파일 형식입니다.");
      return;
    }
    const token = ++reportSelectionToken;
    pendingReport = {
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      extension,
      lastModified: file.lastModified,
      extractionStatus: TEXT_REPORT_EXTENSIONS.has(extension) ? "reading" : BACKEND_REPORT_EXTENSIONS.has(extension) ? "parsing" : "unavailable",
      extractedText: "",
      parsedMarkdown: "",
      parsedJson: null,
      parser: TEXT_REPORT_EXTENSIONS.has(extension) ? "browser" : null,
      warnings: [],
      extractedLength: 0,
      truncated: false
    };
    renderSelectedReport();
    if (BACKEND_REPORT_EXTENSIONS.has(extension)) {
      pendingReportRead = parseReportWithBackend(file, token);
      return;
    }
    if (!TEXT_REPORT_EXTENSIONS.has(extension)) {
      pendingReportRead = Promise.resolve(pendingReport);
      return;
    }
    pendingReportRead = new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (token !== reportSelectionToken) return resolve(null);
        const fullText = typeof reader.result === "string" ? reader.result : "";
        pendingReport.extractionStatus = "available";
        pendingReport.extractedText = redactCredentialText(fullText.slice(0, REPORT_TEXT_LIMIT));
        pendingReport.extractedLength = pendingReport.extractedText.length;
        pendingReport.originalTextLength = file.size <= REPORT_READ_BYTE_LIMIT ? fullText.length : null;
        pendingReport.truncated = file.size > REPORT_READ_BYTE_LIMIT || fullText.length > REPORT_TEXT_LIMIT;
        renderSelectedReport();
        resolve(pendingReport);
      };
      reader.onerror = () => {
        if (token !== reportSelectionToken) return resolve(null);
        pendingReport.extractionStatus = "failed";
        pendingReport.extractedText = "";
        pendingReport.extractedLength = 0;
        renderSelectedReport();
        resolve(pendingReport);
      };
      reader.readAsText(file.slice(0, REPORT_READ_BYTE_LIMIT), "UTF-8");
    });
  }

  async function parseReportWithBackend(file, token) {
    const formData = new FormData();
    formData.append("document", file, file.name);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), file.name.toLowerCase().endsWith(".hwp") ? 300000 : 120000);
    try {
      let response;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await fetch("/api/documents/parse", { method: "POST", body: formData, signal: controller.signal });
        if (![404, 502, 503].includes(response.status) || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
      const payload = await response.json().catch(() => null);
      if (token !== reportSelectionToken) return null;
      if (!response.ok || !payload?.success) {
        pendingReport.extractionStatus = response.status === 404 || response.status === 503 ? "pending" : "failed";
        const categoryLabel = payload?.errorCategory === "parser" ? "Kordoc 문서 파싱 오류" : "백엔드 문서 처리 오류";
        pendingReport.warnings = Array.isArray(payload?.warnings) ? [`${categoryLabel}: ${payload.warnings.join(" / ")}`, ...(payload.requestId ? [`진단 요청 ID: ${payload.requestId}`] : [])] : [`${categoryLabel} (HTTP ${response.status})`];
      } else {
        const markdown = String(payload.markdown || payload.extractedText || "");
        pendingReport.extractionStatus = "available";
        pendingReport.parser = "kordoc";
        pendingReport.parsedMarkdown = redactCredentialText(markdown.slice(0, REPORT_TEXT_LIMIT));
        pendingReport.extractedText = pendingReport.parsedMarkdown;
        pendingReport.extractedLength = pendingReport.extractedText.length;
        pendingReport.truncated = markdown.length > REPORT_TEXT_LIMIT;
        pendingReport.parsedJson = payload.json && typeof payload.json === "object" ? {
          success: payload.json.success,
          metadata: payload.json.metadata || null,
          blockCount: Array.isArray(payload.json.blocks) ? payload.json.blocks.length : 0
        } : null;
        pendingReport.warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
      }
    } catch (error) {
      if (token !== reportSelectionToken) return null;
      pendingReport.extractionStatus = "failed";
      pendingReport.warnings = [error?.name === "AbortError"
        ? `Kordoc HWP 문서 파싱이 ${file.name.toLowerCase().endsWith(".hwp") ? "300초" : "120초"} 안에 완료되지 않았습니다. 문서 크기·구조를 확인한 뒤 다시 시도하세요.`
        : "문서 파싱 백엔드에 연결할 수 없습니다. 서버 상태를 확인한 뒤 다시 시도하세요."];
    } finally {
      clearTimeout(timeout);
    }
    renderSelectedReport();
    return pendingReport;
  }

  async function runRealAnalysis(project, apiKey) {
    AnalysisFlow.stop();
    AnalysisFlow.projectId = project.id;
    if (!project.mockAgentResults || typeof project.mockAgentResults !== "object") project.mockAgentResults = JSON.parse(JSON.stringify(project.agentResults || {}));
    if (!Array.isArray(project.realCompletedAgents)) project.realCompletedAgents = [];
    const completedBefore = Array.isArray(project.realCompletedAgents) ? project.realCompletedAgents : [];
    const requestedAgents = Array.isArray(project.retryAgents) && project.retryAgents.length ? project.retryAgents : analysisAgents.map((agent) => agent.key);
    const priorResults = Object.fromEntries(completedBefore.filter((key) => project.agentResults?.[key]).map((key) => [key, project.agentResults[key]]));
    project.runningAgents = requestedAgents.filter((key) => ["technology", "industry", "policy"].includes(key));
    delete project.retryAgents;
    project.analysisMode = "openai-pending";
    project.analysisStage = "real-running";
    project.analysisError = "";
    project.failedAgent = "";
    project.agentProgress = {};
    project.analysisStartedAt = Date.now();
    State.save();
    navigate("analysis", project.id);
    try {
      const response = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          stream: true,
          agents: requestedAgents,
          priorResults,
          analysisInput: {
            analysisTarget: project.analysisInput.targetProject,
            reportContent: project.analysisInput.reportContent,
            ntisReference: project.analysisInput.sources.ntisReference,
            ntisAchievements: project.analysisInput.sources.ntisAchievements
          }
        })
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.includes("application/x-ndjson")) {
        const payload = await response.json().catch(() => null);
        const failure = new Error(payload?.error?.message || `실제 분석 요청 실패 (HTTP ${response.status})`);
        failure.payload = payload;
        throw failure;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminal = null;
      const applyEvent = (event) => {
        if (event.type === "phase" && event.status === "running") {
          project.runningAgents = Array.isArray(event.runningAgents) ? event.runningAgents : [];
        }
        if (event.type === "progress" && event.agent) {
          project.agentProgress = project.agentProgress || {};
          project.agentProgress[event.agent] = String(event.message || "분석 중입니다.").slice(0, 240);
        }
        if (event.type === "phase" && event.status === "completed") project.runningAgents = [];
        if (event.type === "agent" && event.status === "completed" && event.result && analysisAgents.some((agent) => agent.key === event.agent)) {
          project.agentResults[event.agent] = event.result;
          project.realCompletedAgents = [...new Set([...(project.realCompletedAgents || []), event.agent])];
          project.runningAgents = (project.runningAgents || []).filter((key) => key !== event.agent);
        }
        if (event.type === "complete" || event.type === "error") {
          terminal = event;
          if (event.type === "error") project.errorCategory = event.errorCategory || "backend";
        }
        State.save();
        AnalysisFlow.syncStatuses("real-running");
        renderAnalysis();
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        lines.filter(Boolean).forEach((line) => applyEvent(JSON.parse(line)));
        if (done) break;
      }
      if (buffer.trim()) applyEvent(JSON.parse(buffer));
      if (!terminal?.success) {
        const failure = new Error(terminal?.error?.message || "실제 분석 스트림이 완료되지 않았습니다.");
        failure.payload = terminal;
        throw failure;
      }
      const complete = analysisAgents.every((agent) => project.realCompletedAgents?.includes(agent.key));
      if (!complete) throw new Error("서버가 6개 에이전트 결과를 모두 반환하지 않았습니다.");
      project.analysisMode = "openai";
      project.analysisModel = String(terminal.model || "OpenAI").slice(0, 80);
      project.analysisStage = "complete";
      project.nextType = project.agentResults.final?.primaryNext || "추가 판단 필요";
      project.bottleneck = project.agentResults.final?.bottleneck || project.bottleneck;
      delete project.runningAgents;
      delete project.mockAgentResults;
      State.save();
      AnalysisFlow.syncStatuses("complete");
      renderAnalysis();
      showToast("실제 OpenAI 분석이 완료되었습니다.");
    } catch (error) {
      const apiError = error?.payload?.error || {};
      project.analysisMode = "openai-partial";
      project.failedAgent = analysisAgents.some((agent) => agent.key === apiError.failedAgent) ? apiError.failedAgent : "";
      project.failedPhase = String(apiError.phase || "OpenAI 분석").slice(0, 80);
      project.errorCategory = apiError.code?.startsWith("OPENAI_") ? "openai" : project.errorCategory || "backend";
      project.analysisError = `[${project.errorCategory === "openai" ? "OpenAI upstream 오류" : "백엔드 내부 오류"}] ${String(error?.message || "실제 분석에 실패했습니다.").slice(0, 300)}`;
      project.analysisStage = "real-failed";
      delete project.runningAgents;
      analysisAgents.forEach((agent) => {
        if (!project.realCompletedAgents?.includes(agent.key)) delete project.agentResults[agent.key];
      });
      State.save();
      AnalysisFlow.syncStatuses("real-failed");
      renderAnalysis();
      showToast(`${project.failedPhase} 단계에서 중단되었습니다. 완료 결과는 보존했습니다.`);
    }
  }

  function retryRealAnalysis(project) {
    const keyInput = document.querySelector("[data-retry-api-key]");
    const apiKey = keyInput?.value.trim() || "";
    if (!apiKey) {
      showToast("재시도할 OpenAI API Key를 입력해 주세요.");
      keyInput?.focus();
      return;
    }
    if (keyInput) keyInput.value = "";
    const failedIndex = analysisAgents.findIndex((agent) => agent.key === project.failedAgent);
    project.retryAgents = failedIndex >= 0
      ? [project.failedAgent, ...analysisAgents.slice(Math.max(3, failedIndex + 1)).map((agent) => agent.key)]
      : analysisAgents.filter((agent) => !project.realCompletedAgents?.includes(agent.key)).map((agent) => agent.key);
    runRealAnalysis(project, apiKey);
  }

  function continueWithMock(project) {
    const mockResults = project.mockAgentResults && typeof project.mockAgentResults === "object" ? project.mockAgentResults : {};
    analysisAgents.forEach((agent) => {
      if (!project.agentResults[agent.key] && mockResults[agent.key]) project.agentResults[agent.key] = mockResults[agent.key];
    });
    project.analysisMode = "mock-fallback";
    project.analysisStage = "diagnosis-waiting";
    project.analysisError = `${project.failedPhase || "OpenAI 분석"} 실패 후 사용자가 Mock 계속을 선택했습니다: ${project.analysisError || "원인 미상"}`.slice(0, 300);
    State.save();
    AnalysisFlow.start(project.id);
    showToast("사용자 선택으로 Mock 흐름을 계속합니다. 실제 완료 결과는 보존됩니다.");
  }

  async function startAnalysis(event) {
    event.preventDefault();
    if (!els["analysis-form"].reportValidity() || els["search-button"].disabled) return;
    els["search-button"].disabled = true;
    els["search-button"].innerHTML = '<i class="button-spinner"></i><span>종료보고서 파싱 중…</span>';
    const apiKey = els["openai-api-key"].value.trim();
    const openaiKeyConfigured = Boolean(apiKey);
    const data = {
      id: document.getElementById("project-id").value,
      name: document.getElementById("project-name").value,
      field: document.getElementById("field").value,
      organization: document.getElementById("organization").value
    };
    const loadingLookup = { results: [], counts: {}, warnings: [], source: { provider: "NTIS", endpoint: "natRnDAllSearch", status: "loading", queriedAt: new Date().toISOString() } };
    const project = AnalysisEngine.createProject(data, null, pendingReport, openaiKeyConfigured, NTIS_CONFIGURED, loadingLookup);
    project.analysisStage = "source-loading";
    State.projects.push(project);
    State.save();
    setStep(2);
    clearOpenAIKeyInput();
    AnalysisFlow.stop();
    AnalysisFlow.projectId = project.id;
    navigate("analysis", project.id);
    try {
      // The uploaded HWP/HWPX is the primary analysis source. Parse it first;
      // starting NTIS in parallel made a parser failure look like an NTIS hang.
      const report = await pendingReportRead;
      const requiresParsedReport = Boolean(pendingReport && BACKEND_REPORT_EXTENSIONS.has(pendingReport.extension));
      if (requiresParsedReport && report?.extractionStatus !== "available") {
        project.report = report ? JSON.parse(JSON.stringify(report)) : project.report;
        project.reportSourceMode = reportSourceMode(project);
        project.ntisSource = { ...(project.ntisSource || {}), status: "skipped", skippedReason: "종료보고서 파싱 실패로 NTIS 조회 전 중단" };
        project.ntisWarnings = ["종료보고서 파싱 실패로 NTIS 조회를 시작하지 않았습니다."];
        project.analysisStage = "source-failed";
        project.analysisError = report?.warnings?.length
          ? `종료보고서 Kordoc 파싱 실패: ${report.warnings.join(" / ")}`.slice(0, 600)
          : "종료보고서 Kordoc 파싱이 완료되지 않아 분석을 시작하지 않았습니다.";
        State.save();
        renderAnalysis();
        showToast("HWP/HWPX 파싱이 완료되지 않아 분석을 중단했습니다. 문서를 다시 선택해 재시도하세요.");
        return;
      }
      const ntisLookup = await lookupNtisAchievements(data);
      const enriched = AnalysisEngine.createProject(data, null, report || pendingReport, openaiKeyConfigured, NTIS_CONFIGURED, ntisLookup);
      const identity = { id: project.id, createdAt: project.createdAt, nextType: project.nextType, bottleneck: project.bottleneck };
      Object.assign(project, enriched, identity);
      State.save();
      const statusMessage = ntisLookup.results.length
        ? `NTIS 성과 ${ntisLookup.results.length}건을 참고 근거로 추가했습니다.`
        : "NTIS 성과가 없거나 조회할 수 없어 입력 정보만으로 분석을 계속합니다.";
      showToast(statusMessage);
      if (apiKey) runRealAnalysis(project, apiKey);
      else AnalysisFlow.start(project.id);
    } finally {
      els["search-button"].disabled = false;
      els["search-button"].innerHTML = '<span>▶</span> 분석 시작';
    }
  }

  function resetNewForm() {
    els["analysis-form"].reset();
    clearOpenAIKeyInput();
    clearReportSelection();
    setStep(1);
  }

  function setStep(step) {
    document.querySelectorAll("[data-step-indicator]").forEach((item) => item.classList.toggle("is-active", Number(item.dataset.stepIndicator) <= step));
  }

  function renderProjects() {
    const query = els["project-search"].value.trim().toLowerCase();
    const status = els["status-filter"].value;
    const projects = [...State.projects].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).filter((project) => {
      const matchesQuery = `${project.name} ${project.organization}`.toLowerCase().includes(query);
      return matchesQuery && (status === "all" || project.status === status);
    });
    els["projects-list"].innerHTML = projects.length ? projects.map(projectRow).join("") : emptyState("조건에 맞는 과제가 없습니다", "검색어나 상태 필터를 변경해 보세요.");
    els["nav-project-count"].textContent = State.projects.length;
  }

  function safeList(value, fallback = []) { return Array.isArray(value) ? value : fallback; }
  function listMarkup(items, empty = "추가 판단 필요") {
    const values = safeList(items).filter(Boolean);
    return `<ul>${(values.length ? values : [empty]).map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>`;
  }
  function evidenceMarkup(items) {
    const evidence = safeList(items);
    if (!evidence.length) return `<p class="empty-detail">구조화된 근거 없음 · 기존 형식 결과</p>`;
    return `<div class="evidence-list">${evidence.map((item) => `<article class="evidence-item"><div><strong>${escapeHTML(item.claim || "확인 불가")}</strong><span class="certainty certainty-${escapeHTML(String(item.certainty || "확인 불가").replace(/\s+/g, "-"))}">${escapeHTML(item.certainty || "확인 불가")}</span></div><p>${escapeHTML(item.source || "확인 불가")} · ${escapeHTML(item.sourceType || "확인 불가")} · ${escapeHTML(item.pageOrId || "확인 불가")} · ${escapeHTML(item.publishedDate || "확인되지 않음")} · 등급 ${escapeHTML(item.sourceGrade || "확인 불가")}</p>${item.url ? `<a href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">출처 원문 열기</a>` : ""}</article>`).join("")}</div>`;
  }
  function domainDetailsMarkup(result, compact = false) {
    if (!result?.conclusion && !result?.keyFindings && !result?.evidence) return "";
    const externalStatus = result.searchStatus === "success" && result.sourceCount >= 2 ? `외부근거 확보 ${result.sourceCount}개` : `외부근거 부족 · 확인된 출처 ${result.sourceCount || 0}개 / 최소 2개`;
    const externalSources = safeList(result.externalSources);
    const externalSourceMarkup = externalSources.length ? `<div class="external-source-list"><b>외부 검색 출처</b><ul>${externalSources.map((source) => `<li><a href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.title || source.publisher || source.url)}</a> · ${escapeHTML(source.publishedDate || "확인되지 않음")}</li>`).join("")}</ul></div>` : "";
    if (compact) return `<details class="agent-detail-expand"><summary>판정·근거·불확실성 펼치기</summary><div class="compact-detail"><p><b>외부조사 상태</b>${escapeHTML(externalStatus)}</p>${externalSourceMarkup}<p><b>판정</b>${escapeHTML(result.conclusion || result.summary)}</p><div><b>핵심 발견</b>${listMarkup(result.keyFindings)}</div><div><b>근거</b>${evidenceMarkup(result.evidence)}</div><div class="compact-columns"><section><b>불확실성</b>${listMarkup(result.uncertainties)}</section><section><b>병목</b>${listMarkup(result.bottlenecks)}</section></div></div></details>`;
    return `<section class="detailed-result"><div class="detail-verdict"><span>외부조사 · ${escapeHTML(externalStatus)}</span>${externalSourceMarkup}<p>${escapeHTML(result.conclusion || result.summary)}</p></div><div class="detailed-grid"><section><h3>핵심 발견</h3>${listMarkup(result.keyFindings)}</section><section><h3>근거</h3>${evidenceMarkup(result.evidence)}</section><section><h3>불확실성</h3>${listMarkup(result.uncertainties)}</section><section><h3>핵심 병목</h3>${listMarkup(result.bottlenecks)}</section><section><h3>다음 단계 후보</h3>${listMarkup(result.nextCandidates)}</section><section><h3>추가 데이터 요청</h3>${listMarkup(result.dataRequests)}</section></div><div class="confidence-rationale"><strong>신뢰도 근거</strong><p>${escapeHTML(result.confidenceRationale || "추가 판단 필요")}</p></div></section>`;
  }
  function critiquePanelsMarkup(result, compact = false) {
    const labels = { technology: "Technology · 기술", industry: "Industry · 산업", policy: "Policy · 정책" };
    const fallback = { verdict: "기존 형식 결과: 도메인별 판정 없음", counterArguments: result?.risks || [], weakEvidence: result?.risks || [], verificationQuestions: [result?.insight || "추가 판단 필요"], reversalConditions: ["추가 판단 필요"] };
    const panels = Object.entries(labels).map(([key, label]) => {
      const critique = result?.critiques?.[key] || fallback;
      return `<article class="critique-panel critique-${key}"><header><span>${escapeHTML(label)}</span><strong>${escapeHTML(critique.verdict || "추가 판단 필요")}</strong></header>${compact ? `<details><summary>상세 비판 펼치기</summary>` : ""}<div class="critique-body"><section><b>반론</b>${listMarkup(critique.counterArguments)}</section><section><b>약한 근거</b>${listMarkup(critique.weakEvidence)}</section><section><b>검증 질문</b>${listMarkup(critique.verificationQuestions)}</section><section><b>판단 반전 조건</b>${listMarkup(critique.reversalConditions)}</section></div>${compact ? "</details>" : ""}</article>`;
    }).join("");
    return `<div class="critique-panels">${panels}</div>${compact ? "" : `<div class="challenger-summary-block"><section><h3>에이전트 간 충돌</h3>${listMarkup(result?.crossAgentConflicts)}</section><section><h3>종합 평가</h3><p>${escapeHTML(result?.overallAssessment || result?.summary || "추가 판단 필요")}</p></section><section><h3>신뢰도 근거</h3><p>${escapeHTML(result?.confidenceRationale || "추가 판단 필요")}</p></section></div>`}`;
  }
  function transitionDetailsMarkup(result) {
    const routes = safeList(result?.routeCandidates);
    if (!routes.length) return `<p class="empty-detail">구조화된 경로 비교가 없습니다.</p>`;
    return `<div class="route-comparison">${routes.map((item) => `<article class="route-candidate ${item.route === result.recommendedRoute ? "is-recommended" : ""}"><header><span>${item.route === result.recommendedRoute ? "추천 경로" : "후보 경로"}</span><h4>${escapeHTML(item.route || "추가 판단 필요")}</h4></header><p>${escapeHTML(item.rationale || "추가 판단 필요")}</p><div class="route-candidate-grid"><section><b>선결조건</b>${listMarkup(item.preconditions)}</section><section><b>핵심 병목</b><p>${escapeHTML(item.bottleneck || "추가 판단 필요")}</p></section><section><b>구체 행동</b>${listMarkup(item.actions)}</section><section><b>판단 근거</b>${listMarkup(item.evidence)}</section><section><b>누락 데이터</b>${listMarkup(item.missingData)}</section></div></article>`).join("")}</div><p class="recommended-route"><b>Transition 추천:</b> ${escapeHTML(result.recommendedRoute || "추가 판단 필요")}</p>`;
  }
  function finalDetailsMarkup(result) {
    const plan = safeList(result?.executionPlan);
    const rejected = safeList(result?.rejectedAlternatives);
    return `<div class="final-decision-grid"><section><span>핵심 병목</span><h4>${escapeHTML(result?.bottleneck || "추가 판단 필요")}</h4>${listMarkup(result?.bottleneckEvidence)}</section><section><span>선택 이유</span><p>${escapeHTML(result?.decision || "추가 판단 필요")}</p></section><section><span>선결조건</span>${listMarkup(result?.preconditions)}</section><section><span>재평가 조건</span>${listMarkup(result?.reassessmentTriggers)}</section></div><div class="execution-plan"><h4>실행 계획</h4>${plan.length ? `<ol>${plan.map((item) => `<li><strong>${escapeHTML(item.action || "확인 필요")}</strong><p>담당 ${escapeHTML(item.owner || "확인 필요")} · 시점 ${escapeHTML(item.time || "확인 필요")} · KPI ${escapeHTML(item.KPI || "확인 필요")}</p></li>`).join("")}</ol>` : `<p>확인 필요</p>`}</div><div class="rejected-routes"><h4>미선정 경로</h4>${rejected.length ? rejected.map((item) => `<p><strong>${escapeHTML(item.route || "추가 판단 필요")}</strong> — ${escapeHTML(item.reason || "추가 판단 필요")}</p>`).join("") : `<p>추가 판단 필요</p>`}</div><div class="confidence-rationale"><strong>신뢰도 근거</strong><p>${escapeHTML(result?.confidenceRationale || "추가 판단 필요")}</p></div>`;
  }

  function renderAnalysis() {
    const project = State.project(State.currentProjectId);
    if (!project) return;
    if (AnalysisFlow.projectId !== project.id || !AnalysisFlow.statuses.length) {
      AnalysisFlow.projectId = project.id;
      AnalysisFlow.syncStatuses(project.analysisStage || "complete");
    }
    const stage = project.analysisStage || "complete";
    const completed = AnalysisFlow.statuses.filter((status) => status === "complete").length;
    const progress = (completed / analysisAgents.length) * 100;
    const phaseLabel = stage === "source-loading" ? "NTIS·HWP 파싱" : stage === "source-failed" ? "HWP 파싱 실패" : stage === "real-running" ? "실제 OpenAI 분석중" : stage === "real-failed" ? `${project.failedPhase || "OpenAI 분석"} 실패` : stage.startsWith("diagnosis") ? "1차 진단" : stage.startsWith("challenger") ? "Challenger 검증" : stage.startsWith("transition") ? "Transition 경로설계" : stage.startsWith("synthesis") ? "NEXT Synthesizer" : "분석 완료";
    const stateLabel = (status) => status === "complete" ? "완료" : status === "running" ? "분석중" : "대기";
    const stateBadge = (status) => `<span class="agent-state">${status === "running" ? '<i class="agent-spinner"></i>' : status === "complete" ? '<i class="status-check">✓</i>' : ""}${stateLabel(status)}</span>`;
    const renderAgentCard = (agentIndex) => {
      const agent = analysisAgents[agentIndex];
      const status = AnalysisFlow.statuses[agentIndex] || "waiting";
      const result = project.agentResults[agent.key];
      const waitingMessage = "병렬 진단 시작을 기다리고 있습니다.";
      const liveMessage = project.agentProgress?.[agent.key] || "분석 결과를 생성하는 중입니다…";
      const message = status === "complete" ? result.summary : status === "running" ? liveMessage : waitingMessage;
      return `<article class="analysis-agent-card primary-agent is-${status}" aria-current="${status === "running" ? "step" : "false"}"><span class="agent-icon ${agent.iconClass}">${status === "complete" ? "✓" : agent.icon}</span><div class="agent-card-copy"><div><h2>${agent.name}</h2>${stateBadge(status)}</div><strong>${agent.label}</strong><p>${escapeHTML(message)}</p>${status === "complete" ? `${domainDetailsMarkup(result, true)}<div class="agent-result-meta"><span>진단 점수</span><strong>${result.score}</strong><a href="#detail/${escapeHTML(project.id)}" data-agent-detail="${agent.key}">상세 보기 →</a></div>` : ""}${renderGuardrails(agent.key)}</div></article>`;
    };
    const challengerStatus = AnalysisFlow.statuses[3] || "waiting";
    const transitionStatus = AnalysisFlow.statuses[4] || "waiting";
    const synthesizerStatus = AnalysisFlow.statuses[5] || "waiting";
    const transitionReady = stage === "transition-ready";
    const synthesisReady = stage === "synthesis-ready";
    const challenger = project.agentResults.challenger;
    const transition = project.agentResults.transition;
    const final = project.agentResults.final;
    const isRealRun = ["openai", "openai-pending", "openai-partial"].includes(project.analysisMode);
    const phaseState = (status) => status === "complete" ? "complete" : status === "running" ? "running" : "waiting";
    const diagnosisStatus = AnalysisFlow.statuses.slice(0, 3).every((status) => status === "complete") ? "complete" : AnalysisFlow.statuses.slice(0, 3).some((status) => status === "running") ? "running" : "waiting";
    const phaseTimeline = [["1차 진단", diagnosisStatus], ["Challenger", challengerStatus], ["Transition", transitionStatus], ["NEXT Synthesizer", synthesizerStatus]];
    els["analysis-content"].innerHTML = `
      <header class="analysis-progress-header">
        <div><p class="section-kicker">분석 대상 과제 · PROJECT ANALYSIS WORKSPACE</p><h1>${escapeHTML(project.name)}</h1><p class="page-description">${escapeHTML(project.organization)} · ${escapeHTML(project.field)}</p><span class="source-mode header-source-mode">분석 대상</span></div>
        <div class="workspace-actions"><button class="outline-button" type="button" data-export="${escapeHTML(project.id)}">↓ Markdown 보고서</button><button class="primary outline-button" type="button" data-export-hwpx="${escapeHTML(project.id)}">↓ HWPX 보고서</button><button class="outline-button" type="button" data-open-detail="${escapeHTML(project.id)}">상세 리포트 보기</button></div>
      </header>
      ${renderNtisEvidence(project)}
      ${renderReportSummary(project)}
      <section class="panel credential-source-status" aria-label="자격증명 및 분석 소스 상태">
        <div><span class="status-dot ${project.ntisAchievements?.length ? "is-ready" : ""}"></span><p><strong>NTIS 성과 근거</strong><small>${escapeHTML(ntisStatusText(project))}</small></p></div>
        <div><span class="status-dot ${isRealRun ? "is-ready" : ""}"></span><p><strong>OpenAI · 6 Agents</strong><small>${project.analysisMode === "openai-pending" ? "실제 OpenAI 분석중" : project.analysisMode === "openai" ? `실제 분석 완료 · ${escapeHTML(project.analysisModel || "OpenAI")}` : project.analysisMode === "openai-partial" ? `실제 결과 ${completed}개 보존 · ${escapeHTML(project.failedPhase || "후속 단계")} 중단` : project.analysisMode === "mock-fallback" ? "사용자 선택 · Mock 분석 계속" : "키 미입력 · Mock 분석"}</small></p></div>
        <div><span class="status-dot is-source"></span><p><strong>분석 소스</strong><small>${reportSourceMode(project)}</small></p></div>
      </section>
      <div class="panel overall-progress">
        <div><span>${completed === 6 ? "모든 분석과 최종 추천이 준비되었습니다." : "에이전트의 진행 상태와 근거를 한 화면에서 확인하세요."}</span><strong class="current-phase-label">현재 단계 · ${phaseLabel}</strong></div>
        <div class="analysis-progress-track" role="progressbar" aria-label="전체 분석 진행률" aria-valuemin="0" aria-valuemax="6" aria-valuenow="${completed}"><span style="--progress:${progress}%"></span></div>
        <p>${completed} / 6 에이전트 완료 · ${isRealRun ? "실제 실행은 전체 파이프라인을 자동 진행합니다." : "Mock에서는 Transition과 NEXT Synthesizer를 사용자가 직접 실행합니다."}</p>
        ${project.analysisMode === "openai-partial" ? `<div class="analysis-error recovery-panel" role="alert"><div><strong>${escapeHTML(project.failedPhase || "OpenAI 분석")} 에이전트에서 실행이 중단되었습니다.</strong><p>${escapeHTML(project.analysisError)} 완료된 ${completed}개 결과는 그대로 보존됩니다. 잠시 후 실패 단계부터 재시도하거나, 원할 때만 Mock으로 계속하세요.</p></div><div class="recovery-actions"><input type="password" autocomplete="new-password" spellcheck="false" data-retry-api-key placeholder="재시도용 OpenAI API Key" aria-label="재시도용 OpenAI API Key"><button class="primary" type="button" data-retry-real>실패 단계 재시도</button><button class="outline-button" type="button" data-continue-mock>Mock으로 계속</button></div></div>` : project.analysisError ? `<p class="analysis-error" role="alert">${escapeHTML(project.analysisError)}</p>` : ""}
      </div>
      <ol class="panel phase-timeline" aria-label="분석 단계 타임라인">${phaseTimeline.map(([label, status], index) => `<li class="is-${status}"><span>${status === "complete" ? "✓" : index + 1}</span><div><strong>${label}</strong><small>${stateLabel(status)}</small></div></li>`).join("")}</ol>
      <div class="analysis-workspace">
        <section class="workspace-phase diagnosis-phase is-${phaseState(AnalysisFlow.statuses[0])}">
          <header class="workspace-phase-heading"><span class="phase-index">01</span><div><p class="section-kicker">PARALLEL DIAGNOSIS</p><h2>1차 진단</h2><p>기술·산업·정책 에이전트가 독립적으로 동시에 분석합니다.</p></div></header>
          <div class="diagnosis-grid">${[0, 1, 2].map(renderAgentCard).join("")}</div>
        </section>

        <section class="workspace-phase challenger-phase is-${phaseState(challengerStatus)}">
          <header class="workspace-phase-heading"><span class="phase-index">02</span><div><p class="section-kicker">ADVERSARIAL REVIEW</p><h2>Challenger 검증</h2><p>낙관적 가정을 뒤집어 보고 의사결정 전에 반드시 확인할 조건을 찾습니다.</p></div>${stateBadge(challengerStatus)}</header>
          <article class="panel challenger-panel is-${challengerStatus}">
            <div class="challenger-intro"><span class="agent-icon challenge">${challengerStatus === "complete" ? "✓" : "C"}</span><div><h3>Challenger</h3><p>${challengerStatus === "complete" ? escapeHTML(challenger.summary) : challengerStatus === "running" ? "세 진단의 결론을 교차 검증하고 있습니다." : "1차 진단 세 에이전트의 완료를 기다리고 있습니다."}</p></div></div>
            ${renderGuardrails("challenger")}
            ${challengerStatus === "complete" ? `${critiquePanelsMarkup(challenger, true)}<div class="cross-conflicts"><strong>교차 충돌</strong>${listMarkup(challenger.crossAgentConflicts, challenger.insight || "추가 판단 필요")}</div>` : `<div class="panel-loading"><i class="${challengerStatus === "running" ? "agent-spinner" : "lock-icon"}">${challengerStatus === "waiting" ? "⌛" : ""}</i><span>${challengerStatus === "running" ? "반론·충돌·약한 근거를 탐색하는 중" : "1차 진단 완료 후 자동으로 시작됩니다"}</span></div>`}
          </article>
        </section>

        <section class="workspace-phase transition-phase is-${phaseState(transitionStatus)}">
          <header class="workspace-phase-heading"><span class="phase-index">03</span><div><p class="section-kicker">${isRealRun ? "SEQUENTIAL ROUTE DESIGN" : "HUMAN-TRIGGERED ROUTE DESIGN"}</p><h2>Transition 경로설계</h2><p>검증된 병목을 실행 가능한 단계와 게이트로 전환합니다.</p></div>${stateBadge(transitionStatus)}</header>
          ${!isRealRun ? `<div class="action-gate panel ${transitionReady ? "is-ready" : ""}">
            <div class="gate-copy"><span class="gate-symbol">${transitionReady ? "→" : transitionStatus === "complete" ? "✓" : transitionStatus === "running" ? "◌" : "🔒"}</span><div><strong>${transitionReady ? "경로설계를 실행할 준비가 되었습니다" : transitionStatus === "complete" ? "경로설계 완료" : transitionStatus === "running" ? "Transition이 실행 경로를 설계하고 있습니다" : "Challenger 검증 완료 전까지 잠겨 있습니다"}</strong><small>자동 실행되지 않습니다. 아래 버튼을 눌러 다음 단계로 진행하세요.</small></div></div>
            <button class="phase-action transition-action" type="button" data-run-transition ${transitionReady ? "" : "disabled"}>${transitionStatus === "running" ? '<i class="button-spinner"></i>' : ""}<span>Transition 경로설계 실행</span></button>
          </div>` : ""}
          ${renderGuardrails("transition")}
          ${transitionStatus === "complete" ? `<article class="panel route-result"><div class="result-title"><span class="agent-icon transition">R</span><div><p class="section-kicker">ROUTE DESIGN RESULT</p><h3>${escapeHTML(transition.summary)}</h3></div><strong>${transition.score}<small>/100</small></strong></div>${transitionDetailsMarkup(transition)}<p class="route-insight">${escapeHTML(transition.insight)}</p></article>` : ""}
        </section>

        <section class="workspace-phase synthesizer-phase is-${phaseState(synthesizerStatus)}">
          <header class="workspace-phase-heading"><span class="phase-index">04</span><div><p class="section-kicker">FINAL SYNTHESIS</p><h2>NEXT Synthesizer</h2><p>모든 진단과 검증, 경로설계를 결합해 최종 추천을 생성합니다.</p></div>${stateBadge(synthesizerStatus)}</header>
          ${!isRealRun ? `<div class="synth-action-wrap"><button class="phase-action synth-action" type="button" data-run-synthesizer ${synthesisReady ? "" : "disabled"}>${synthesizerStatus === "running" ? '<i class="button-spinner"></i>' : '<span class="button-mark">N</span>'}<span>NEXT Synthesizer 최종 추천 생성</span></button><p>${synthesisReady ? "Transition 결과가 준비되었습니다. 최종 추천을 생성하세요." : synthesizerStatus === "complete" ? "최종 추천이 생성되었습니다." : "Transition 경로설계를 완료하면 활성화됩니다."}</p></div>` : ""}
          ${renderGuardrails("final")}
          ${synthesizerStatus === "complete" ? `<article class="panel final-recommendation"><div class="final-hero"><div><p class="section-kicker">FINAL NEXT RECOMMENDATION</p><span>PRIMARY NEXT</span><h3>${escapeHTML(final.primaryNext || project.nextType || "추가 판단 필요")}</h3><p>${escapeHTML(final.decision || final.summary)}</p></div><div class="confidence-ring" style="--confidence:${final.confidence ?? final.score}"><strong>${final.confidence ?? final.score}%</strong><small>CONFIDENCE</small></div></div>${finalDetailsMarkup(final)}</article>` : ""}
        </section>
      </div>`;
  }

  function renderDetail() {
    const project = State.project(State.currentProjectId);
    if (!project) return;
    const selectedAgent = analysisAgents.find((agent) => agent.key === State.currentTab) || analysisAgents[0];
    const result = project.agentResults[State.currentTab] || project.agentResults.technology || { name: selectedAgent.name, subtitle: selectedAgent.label, score: 0, summary: "이 에이전트 단계는 아직 완료되지 않았습니다.", strengths: [], risks: [], insight: "실패 단계 재시도가 필요합니다." };
    const tabs = [
      ["technology", "Technology"], ["industry", "Industry"], ["policy", "Policy"], ["challenger", "Challenger"], ["transition", "Transition"], ["final", "최종 NEXT"]
    ];
    els["detail-content"].innerHTML = `
      <header class="detail-header">
        <div><p class="section-kicker">분석 대상 과제 · ${project.analysisMode === "openai" ? "REAL OPENAI ANALYSIS" : project.analysisMode === "openai-partial" ? "PARTIAL OPENAI ANALYSIS" : "MOCK ANALYSIS"}</p><h1>${escapeHTML(project.name)}</h1><p class="page-description">${escapeHTML(project.organization)} · ${escapeHTML(project.field)}</p><span class="source-mode header-source-mode">분석 대상</span></div>
        <div class="detail-actions"><button class="outline-button" type="button" data-open-project="${escapeHTML(project.id)}">← 워크스페이스</button><button class="outline-button" type="button" data-export="${escapeHTML(project.id)}">↓ Markdown 보고서</button><button class="primary outline-button" type="button" data-export-hwpx="${escapeHTML(project.id)}">↓ HWPX 보고서</button></div>
      </header>
      <div class="detail-summary"><div class="summary-item"><small>NEXT 유형</small><span class="type-badge" data-next-type="${escapeHTML(project.nextType)}">${escapeHTML(project.nextType)}</span></div><div class="summary-item"><small>수행 기간</small><strong>${escapeHTML(project.period)}</strong></div><div class="summary-item"><small>예산</small><strong>${escapeHTML(project.budget)}</strong></div><div class="summary-item"><small>의사결정</small><span class="status-badge ${statusClass(project.status)}">${escapeHTML(project.status)}</span></div></div>
      ${renderNtisEvidence(project)}
      ${renderReportSummary(project, true)}
      <div class="tabs" role="tablist">${tabs.map(([key, label]) => `<button class="tab-button ${State.currentTab === key ? "is-active" : ""}" type="button" role="tab" aria-selected="${State.currentTab === key}" data-tab="${key}">${label}</button>`).join("")}</div>
      <article class="panel result-panel">
        <div class="result-head"><div><span class="agent-icon ${State.currentTab}">${State.currentTab === "final" ? "N" : result.name.charAt(0)}</span><div><p class="section-kicker">AGENT REPORT</p><h2>${escapeHTML(result.name)} · ${escapeHTML(result.subtitle)}</h2></div></div><div class="score-ring" style="--score:${result.score}"><span>${result.score}</span></div></div>
        ${renderGuardrails(State.currentTab, true)}
        <div class="result-grid"><div class="result-block"><h3>분석 요약</h3><p>${escapeHTML(result.summary)}</p><h3>주요 강점</h3>${listMarkup(result.strengths)}</div><div class="result-block"><h3>위험 및 검토사항</h3>${listMarkup(result.risks)}<h3>에이전트 핵심 제안</h3><div class="insight-box"><p>${escapeHTML(result.insight)}</p></div></div></div>
        ${["technology", "industry", "policy"].includes(State.currentTab) ? domainDetailsMarkup(result) : State.currentTab === "challenger" ? critiquePanelsMarkup(result) : State.currentTab === "transition" ? transitionDetailsMarkup(result) : State.currentTab === "final" ? finalDetailsMarkup(result) : ""}
      </article>
      <div class="panel decision-bar"><p><strong>검토 의사결정</strong><small>선택한 상태는 이 브라우저에 자동 저장됩니다.</small></p><div class="decision-buttons">${["승인", "수정요청", "보류"].map((status) => `<button class="decision-button ${project.status === status ? "is-active" : ""}" type="button" data-status="${status}">${status === "승인" ? "✓ " : status === "수정요청" ? "↻ " : "Ⅱ "}${status}</button>`).join("")}</div></div>`;
  }

  function updateStatus(status) {
    const project = State.project(State.currentProjectId);
    if (!project) return;
    project.status = status;
    State.save();
    renderDetail();
    showToast(`과제를 ‘${status}’ 상태로 저장했습니다.`);
  }

  function buildReportMarkdown(id) {
    const project = State.project(id);
    if (!project) return;
    const reference = project.ntisReference || {};
    const achievements = Array.isArray(project.ntisAchievements) ? project.ntisAchievements : [];
    const achievementLines = achievements.length ? achievements.map((item) => `- [${item.type || item.collection || "성과"}] ${item.title || item.id || "제목 정보 없음"}${item.organization ? ` · ${item.organization}` : ""}${item.year ? ` · ${item.year}` : ""}${item.projectId ? ` · 과제 ${item.projectId}` : ""}`).join("\n") : "- 조회된 성과 없음";
    const legacyReference = reference.id ? `\n\n### 기존 저장 프로젝트 NTIS 참고자료\n\n- 과제번호: ${reference.id}\n- 과제명: ${reference.title || "정보 없음"}\n- 수행기관: ${reference.org || "정보 없음"}\n- 용도: 분석 대상이 아닌 이전 버전 참고자료` : "";
    const mdList = (items) => (Array.isArray(items) && items.length ? items : ["추가 판단 필요"]).map((item) => `- ${item}`).join("\n");
    const externalResearchMarkdown = (result) => `\n\n### 외부조사 상태\n\n- 상태: ${result.searchStatus || "미수행"}\n- 확인된 외부 출처: ${result.sourceCount || 0}개 / 최소 2개\n${safeList(result.externalSources).length ? safeList(result.externalSources).map((source, index) => `${index + 1}. ${source.title || "제목 확인 필요"} · ${source.publisher || "확인 필요"} · ${source.publishedDate || "확인되지 않음"}\n   - URL: ${source.url}`).join("\n") : "- 외부근거 없음 · 확인 필요"}`;
    const detailedDomainMarkdown = (result) => !result.conclusion && !result.keyFindings ? "" : `${externalResearchMarkdown(result)}\n\n### 판정\n\n${result.conclusion || result.summary}\n\n### 핵심 발견\n${mdList(result.keyFindings)}\n\n### 근거\n${safeList(result.evidence).length ? result.evidence.map((item, index) => `${index + 1}. **${item.claim || "확인 불가"}**\n   - 출처: ${item.source || "확인 불가"}\n   - 유형/페이지·ID: ${item.sourceType || "확인 불가"} / ${item.pageOrId || "확인 불가"}\n   - 발행일: ${item.publishedDate || "확인되지 않음"}\n   - 출처등급: ${item.sourceGrade || "확인 불가"}\n   - URL: ${item.url || "확인되지 않음"}\n   - 확실성: ${item.certainty || "확인 불가"}`).join("\n") : "- 구조화된 근거 없음 · 기존 형식 결과"}\n\n### 불확실성\n${mdList(result.uncertainties)}\n\n### 핵심 병목\n${mdList(result.bottlenecks)}\n\n### 다음 단계 후보\n${mdList(result.nextCandidates)}\n\n### 추가 데이터 요청\n${mdList(result.dataRequests)}\n\n### 신뢰도 근거\n\n${result.confidenceRationale || "추가 판단 필요"}`;
    const challengerMarkdown = (result) => {
      if (!result.critiques) return "";
      const labels = { technology: "Technology 기술 비판", industry: "Industry 산업 비판", policy: "Policy 정책 비판" };
      const subLabels = ["가", "나", "다"];
      const critiques = Object.entries(labels).map(([key, label], index) => { const item = result.critiques[key] || {}; return `### ${index + 1}) ${label}\n\nㅇ 판정: ${item.verdict || "추가 판단 필요"}\n\n#### ${subLabels[0]}) 반론\n${mdList(item.counterArguments)}\n\n#### ${subLabels[1]}) 약한 근거\n${mdList(item.weakEvidence)}\n\n#### ${subLabels[2]}) 검증 질문\n${mdList(item.verificationQuestions)}\n\n#### 라) 판단 반전 조건\n${mdList(item.reversalConditions)}`; }).join("\n\n");
      return `\n\n${critiques}\n\n### 에이전트 간 충돌\n${mdList(result.crossAgentConflicts)}\n\n### Challenger 종합 평가\n\n${result.overallAssessment || result.summary}\n\n### 신뢰도 근거\n\n${result.confidenceRationale || "추가 판단 필요"}`;
    };
    const transitionRouteLabels = ["가", "나", "다"];
    const transitionMarkdown = (result) => `\n\n### 1) 경로 비교\n\n${safeList(result.routeCandidates).map((item, index) => `#### ${transitionRouteLabels[index] || "가"}) ${item.route || "추가 판단 필요"}${item.route === result.recommendedRoute ? " (추천)" : ""}\n\nㅇ 이유 : ${item.rationale || "추가 판단 필요"}\n\nㅇ 병목 : ${item.bottleneck || "추가 판단 필요"}\n\nㅇ 선결조건\n${mdList(item.preconditions)}\n\nㅇ 행동\n${mdList(item.actions)}\n\nㅇ 근거\n${mdList(item.evidence)}\n\nㅇ 누락 데이터\n${mdList(item.missingData)}`).join("\n\n")}\n\n➔ 추천 경로 : ${result.recommendedRoute || "추가 판단 필요"}`;
    const finalMarkdown = (result) => `\n\n### 최종 결정\n\n- 주요 NEXT: ${result.primaryNext || "추가 판단 필요"}\n- 핵심 병목: ${result.bottleneck || "추가 판단 필요"}\n- 선택 이유: ${result.decision || "추가 판단 필요"}\n- 신뢰도: ${result.confidence ?? result.score}%\n\n#### 병목 근거\n${mdList(result.bottleneckEvidence)}\n\n#### 선결조건\n${mdList(result.preconditions)}\n\n#### 실행 계획\n${safeList(result.executionPlan).map((item, index) => `${index + 1}. **${item.action || "확인 필요"}**\n   - 담당: ${item.owner || "확인 필요"}\n   - 시점: ${item.time || "확인 필요"}\n   - KPI: ${item.KPI || "확인 필요"}`).join("\n") || "- 확인 필요"}\n\n#### 미선정 경로\n${safeList(result.rejectedAlternatives).map((item) => `- **${item.route || "추가 판단 필요"}**: ${item.reason || "추가 판단 필요"}`).join("\n") || "- 추가 판단 필요"}\n\n#### 재평가 조건\n${mdList(result.reassessmentTriggers)}\n\n#### 신뢰도 근거\n\n${result.confidenceRationale || "추가 판단 필요"}`;
    const sections = Object.entries(project.agentResults).map(([key, result]) => `## ${result.name} — ${result.score}/100\n\n${result.summary}\n\n### 주요 강점\n${mdList(result.strengths)}\n\n### 위험 및 검토사항\n${mdList(result.risks)}\n\n> 핵심 제안: ${result.insight}${["technology", "industry", "policy"].includes(key) ? detailedDomainMarkdown(result) : key === "challenger" ? challengerMarkdown(result) : key === "transition" ? transitionMarkdown(result) : key === "final" ? finalMarkdown(result) : ""}`).join("\n\n---\n\n");
    let attachmentSection = `## 첨부자료\n\n- 종료보고서: 없음\n- 분석 소스: ${reportSourceMode(project)}`;
    if (project.report) {
      const attachment = project.report;
      const attachmentText = attachment.parsedMarkdown || attachment.extractedText || "";
      const excerpt = attachment.extractionStatus === "available" && attachmentText
        ? attachmentText.slice(0, REPORT_EXPORT_EXCERPT_LIMIT)
        : "";
      const noExcerptMessage = attachment.extractionStatus === "available"
        ? "> 추출된 텍스트가 비어 있습니다."
        : attachment.extractionStatus === "failed"
          ? "> 문서 파싱에 실패해 발췌를 포함하지 않았습니다."
          : attachment.extractionStatus === "pending"
            ? "> 문서 파싱 백엔드를 사용할 수 없어 파싱 대기 상태입니다. 파일 메타데이터만 포함했습니다."
            : "> 이 파일 형식의 본문을 추출하지 않았습니다. 파일 메타데이터만 포함했습니다.";
      attachmentSection = `## 첨부자료\n\n- 파일명: ${attachment.name}\n- 크기: ${formatBytes(attachment.size)}\n- 형식: ${(attachment.extension || "파일").toUpperCase()}\n- 텍스트 처리: ${extractionLabel(attachment)}\n- 분석 소스: ${reportSourceMode(project)}\n\n### 보고서 발췌\n\n${excerpt ? `\`\`\`text\n${excerpt}\n\`\`\`${attachmentText.length > excerpt.length ? "\n\n> 발췌문은 4,000자로 제한되었습니다." : ""}` : noExcerptMessage}`;
    }
    const provenance = project.analysisMode === "openai" ? `OpenAI ${project.analysisModel || "모델"}이 입력 근거로 생성한 실제 API 분석입니다.` : project.analysisMode === "mock-fallback" ? `OpenAI 호출 실패(${project.analysisError || "원인 미상"}) 후 Mock 분석으로 생성되었습니다.` : "파일럿 Mock 데이터로 생성되었으며 실제 API 분석 결과가 아닙니다.";
    const result = project.agentResults || {};
    const domainSections = ["technology", "industry", "policy"].map((key) => {
      const item = result[key];
      return item ? `## ${item.name || key} Agent [${item.score ?? "-"}/100]\n\n${item.summary || "추가 판단 필요"}\n\n### 주요 강점\n${mdList(item.strengths)}\n\n### 위험 및 검토사항\n${mdList(item.risks)}\n\n> 핵심 제안: ${item.insight || "추가 판단 필요"}${detailedDomainMarkdown(item)}` : "";
    }).filter(Boolean).join("\n\n---\n\n");
    const report = `# R&D NEXT 분석 보고서\n\n## ${project.name || "과제명 미입력"}\n\n> ${provenance}\n\n목 차\n\n1. 분석 개요\n\n2. Agent 진단 결과\n\n3. Agent 검증\n\n4. Agent 종합 분석\n\n5. NEXT 전환경로 설계\n\n1. 분석 개요\n\n## 가. 분석대상\n\nㅇ 과제번호 : ${project.projectId || "미입력"}\n\nㅇ 연구분야 : ${project.field || "미입력"}\n\nㅇ 과제명 : ${project.name || "미입력"}\n\nㅇ 연구개발기관 : ${project.organization || "미입력"}\n\n## 나. NTIS R&D 성과 참고 근거 (분석대상 아님)\n\nㅇ 조회 상태: ${ntisStatusText(project)}\n\nㅇ 컬렉션: 논문(rpaper), 특허(rpatent), 연구보고서(rresearch)\n\n${achievementLines}${legacyReference}\n\n다. 분석 입력 및 데이터 상태\n\nㅇ 분석 소스: ${reportSourceMode(project)}\n\nㅇ NEXT 유형: ${project.nextType || "추가 판단 필요"}\n\nㅇ 검토 상태: ${project.status || "검토 대기"}\n\nㅇ 보고서 생성일: ${new Date().toLocaleDateString("ko-KR")}\n\n라. 첨부자료\n\n${attachmentSection}\n\n2. Agent 진단 결과\n\n${domainSections || "추가 판단 필요"}\n\n3. Agent 검증\n\n## 바. Challenger Agent [${result.challenger?.score ?? "-"}/100]\n\n${result.challenger?.summary || "추가 판단 필요"}${result.challenger ? challengerMarkdown(result.challenger) : ""}\n\n4. Agent 종합 분석\n\n## 사. Transition Agent [${result.transition?.score ?? "-"}/100]\n\n${result.transition?.summary || "추가 판단 필요"}${result.transition ? transitionMarkdown(result.transition) : ""}\n\n5. NEXT 전환경로 설계\n\n## 아. NEXT Synthesizer [${result.final?.score ?? "-"}/100]\n\n${result.final?.summary || "추가 판단 필요"}${result.final ? finalMarkdown(result.final) : ""}\n`;
    return { project, markdown: report };
  }

  function exportReport(id) {
    const payload = buildReportMarkdown(id);
    if (!payload) return;
    const blob = new Blob([payload.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `RND_NEXT_${payload.project.id}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Markdown 보고서를 다운로드했습니다.");
  }

  async function exportHwpReport(id) {
    const payload = buildReportMarkdown(id);
    if (!payload) return;
    try {
      showToast("Kordoc으로 HWPX 보고서를 생성하는 중입니다…");
      const response = await fetch("/api/reports/hwpx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: payload.markdown, projectName: payload.project.name, organization: payload.project.organization })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || `HWPX 생성 실패 (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("생성된 HWPX 파일이 비어 있습니다.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `RND_NEXT_${payload.project.id}.hwpx`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(`Kordoc HWPX 보고서 다운로드를 시작했습니다. (${Math.round(blob.size / 1024)} KB)`);
    } catch (error) {
      showToast(`HWPX 보고서 생성 실패: ${String(error.message || error).slice(0, 160)}`);
    }
  }

  function handleClick(event) {
    const routeButton = event.target.closest("[data-route]");
    if (routeButton) return navigate(routeButton.dataset.route);
    const projectButton = event.target.closest("[data-open-project]");
    if (projectButton) return navigate("analysis", projectButton.dataset.openProject);
    const detailButton = event.target.closest("[data-open-detail]");
    if (detailButton) return navigate("detail", detailButton.dataset.openDetail);
    const removeReportButton = event.target.closest("[data-remove-report]");
    if (removeReportButton) {
      clearReportSelection();
      showToast("첨부파일을 제거했습니다.");
      return;
    }
    const agentDetail = event.target.closest("[data-agent-detail]");
    if (agentDetail) { event.preventDefault(); State.currentTab = agentDetail.dataset.agentDetail; return navigate("detail", State.currentProjectId); }
    if (event.target.closest("[data-run-transition]")) return AnalysisFlow.runTransition();
    if (event.target.closest("[data-run-synthesizer]")) return AnalysisFlow.runSynthesizer();
    if (event.target.closest("[data-retry-real]")) {
      const project = State.project(State.currentProjectId);
      if (project) return retryRealAnalysis(project);
    }
    if (event.target.closest("[data-continue-mock]")) {
      const project = State.project(State.currentProjectId);
      if (project) return continueWithMock(project);
    }
    const tab = event.target.closest("[data-tab]");
    if (tab) { State.currentTab = tab.dataset.tab; return renderDetail(); }
    const status = event.target.closest("[data-status]");
    if (status) return updateStatus(status.dataset.status);
    const exportButton = event.target.closest("[data-export]");
    if (exportButton) return exportReport(exportButton.dataset.export);
    const hwpExportButton = event.target.closest("[data-export-hwpx]");
    if (hwpExportButton) return exportHwpReport(hwpExportButton.dataset.exportHwpx);
  }

  function bindEvents() {
    document.addEventListener("click", handleClick);
    window.addEventListener("hashchange", renderRoute);
    els["analysis-form"].addEventListener("submit", startAnalysis);
    els["final-report"].addEventListener("change", handleReportSelection);
    els["openai-api-key"].addEventListener("input", updateOpenAIKeyStatus);
    els["toggle-openai-key"].addEventListener("click", toggleOpenAIKeyVisibility);
    els["project-search"].addEventListener("input", renderProjects);
    els["status-filter"].addEventListener("change", renderProjects);
    document.getElementById("back-to-projects").addEventListener("click", () => navigate("projects"));
    els["menu-button"].addEventListener("click", () => {
      const open = els.sidebar.classList.toggle("is-open");
      els["sidebar-overlay"].classList.toggle("is-open", open);
      els["menu-button"].setAttribute("aria-expanded", String(open));
    });
    els["sidebar-overlay"].addEventListener("click", closeSidebar);
  }

  function init() {
    cacheElements();
    renderNtisConnectionStatus();
    State.load();
    bindEvents();
    if (!location.hash) location.hash = "#dashboard";
    renderRoute();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
