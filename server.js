"use strict";

const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const fsSync = require("node:fs");
const crypto = require("node:crypto");

const ROOT = __dirname;

// Load local server secrets without exposing them to the browser.
try {
  const envPath = path.join(ROOT, ".env");
  if (fsSync.existsSync(envPath)) {
    for (const line of fsSync.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && !match[1].startsWith("#") && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^([\"'])(.*)\1$/, "$2");
      }
    }
  }
} catch (error) {
  console.warn(`환경변수 파일을 읽지 못했습니다: ${error.message}`);
}
const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_AGENT_REQUEST_BYTES = 256 * 1024;
const MAX_REPORT_CHARS = 50000;
const MAX_AGENT_COUNT = 6;
const OPENAI_TIMEOUT_MS = 75000;
const OPENAI_PHASE_TIMEOUT_MS = Object.freeze({ challenger: 75000, transition: 90000, final: 90000 });
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_MAX_TOKENS = 3600;
const MAX_PROMPT_CHARS = 42000;
const NTIS_ENDPOINT = "https://www.ntis.go.kr/rndopen/openApi/natRnDAllSearch";
const NTIS_TIMEOUT_MS = 10000;
const MAX_NTIS_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_NTIS_RESULTS_PER_COLLECTION = 10;
const NTIS_COLLECTIONS = Object.freeze({ rpaper: "PAP", rpatent: "PAT", rresearch: "TRKO" });
const MAX_PARSER_OUTPUT_BYTES = 32 * 1024 * 1024;
const PARSER_TIMEOUT_MS = 120000;
const PARSABLE_EXTENSIONS = new Set(["pdf", "hwp", "hwpx"]);
const PUBLIC_FILES = new Set(["index.html", "project-model.js", "app.js", "styles.css", "preview.html"]);
const CONTENT_TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function diagnosticId() {
  return crypto.randomUUID();
}

function diagnosticHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function diagnosticError(error) {
  return {
    type: error?.name || "Error",
    code: error?.code || undefined,
    message: String(error?.message || "알 수 없는 오류").replace(/(?:sk|key|token|authorization|bearer)[^\s,;]*/gi, "[REDACTED]").slice(0, 300)
  };
}

function diagnosticLog(event, fields = {}) {
  console.warn(JSON.stringify({
    ts: new Date().toISOString(),
    component: "rnd-next",
    event,
    ...fields
  }));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        rejected = true;
        chunks.length = 0;
        const error = new Error("업로드는 25MB를 초과할 수 없습니다.");
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => { if (!rejected) resolve(Buffer.concat(chunks)); });
    request.on("error", reject);
  });
}

function readJsonBody(request, limit = MAX_AGENT_REQUEST_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    request.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        const error = new Error("요청 본문이 허용 크기를 초과했습니다.");
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (_) {
        const error = new Error("유효한 JSON 요청이 필요합니다.");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function xmlLeafValues(fragment) {
  const values = {};
  const leaf = /<([A-Za-z_][\w:.-]*)\b[^>]*>\s*(<!\[CDATA\[[\s\S]*?\]\]>|[^<]*)\s*<\/\1>/g;
  let match;
  while ((match = leaf.exec(fragment))) {
    const key = match[1].split(":").pop().toUpperCase();
    const value = decodeXmlText(match[2]);
    if (value && values[key] === undefined) values[key] = value.slice(0, 1000);
  }
  return values;
}

function firstXmlValue(values, names) {
  for (const name of names) if (values[name] !== undefined) return values[name];
  return "";
}

function normalizeNtisHit(collection, fragment) {
  const values = xmlLeafValues(fragment);
    const titleFields = collection === "rpaper"
    ? ["PAPER_NM", "PAPERNAME", "TITLE", "KOR_TITLE", "RESULTTITLE"]
    : collection === "rpatent"
      ? ["IPR_INVENTION_NM", "INVENTIONNAME", "PATENT_NM", "TITLE", "RESULTTITLE"]
      : ["KOR_RPT_TITLE_NM", "REPORTTITLE", "RPT_NM", "TITLE", "RESULTTITLE"];
  const item = {
    collection,
    type: collection === "rpaper" ? "paper" : collection === "rpatent" ? "patent" : "researchReport",
    id: firstXmlValue(values, ["RST_ID", "RESULT_ID", "RESULTID", "ID", "PAPER_ID", "PATENT_ID", "RPT_ID"]),
    title: firstXmlValue(values, titleFields),
    projectId: firstXmlValue(values, ["PJT_ID", "PROJECTNUMBER", "PROJECT_ID", "PROJECTID", "PJT_NO"]),
    projectName: firstXmlValue(values, ["KOR_PJT_NM", "PROJECTTITLE", "PJT_NM", "PROJECT_NAME"]),
    organization: firstXmlValue(values, ["ORG_NM", "ORGANIZATION", "RESEARCHAGENCY", "PERFORMAGENCY", "AUTHOR_AFFILIATION", "PUBLISHER_NM", "APPLICANT_NM"]),
    year: firstXmlValue(values, ["PERFORMANCE_YEAR", "PUB_YEAR", "PUBLICATION_YEAR", "ISSUE_YEAR", "YEAR", "RPT_YEAR", "APPL_YEAR", "PUBYEAR"]),
    authors: firstXmlValue(values, ["AUTHOR_NM", "AUTHORS", "INVENTOR_NM", "RSC_NM"])
  };
  return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== ""));
}

function parseNtisXml(collection, xml) {
  if (!/^\s*</.test(xml) || /<(?:ERROR|error|fault)\b/.test(xml)) throw new Error("NTIS가 유효한 검색 XML을 반환하지 않았습니다.");
  const responseCode = /<(?:resCode|resultCode)\b[^>]*>\s*([^<]+)\s*<\/(?:resCode|resultCode)>/i.exec(xml)?.[1]?.trim();
  if (responseCode && !/^(?:0|00|success)$/i.test(responseCode)) throw new Error("NTIS가 오류 상태를 반환했습니다.");
  if (!/<RESULTSET\b/i.test(xml) && /<(?:resMsg|resultMsg)\b/i.test(xml)) throw new Error("NTIS 검색 서비스를 사용할 수 없습니다.");
  const results = [];
  const hitPattern = /<HIT\b[^>]*>([\s\S]*?)<\/HIT>/gi;
  let match;
  while ((match = hitPattern.exec(xml)) && results.length < MAX_NTIS_RESULTS_PER_COLLECTION) {
    const normalized = normalizeNtisHit(collection, match[1]);
    if (normalized.id || normalized.title || normalized.projectId) results.push(normalized);
  }
  const totalMatch = /<TOTALHITS\b[^>]*>\s*(\d+)\s*<\/TOTALHITS>/i.exec(xml);
  return { results, total: totalMatch ? Number.parseInt(totalMatch[1], 10) : results.length };
}

async function readCappedResponse(response, limit) {
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limit) throw new Error("NTIS 응답 크기 제한을 초과했습니다.");
    return buffer.toString("utf8");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new Error("NTIS 응답 크기 제한을 초과했습니다.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchNtisCollection(collection, dbt, searchWord, apiKey, requestId) {
  const startedAt = Date.now();
  const endpointPath = new URL(NTIS_ENDPOINT).pathname;
  diagnosticLog("ntis.request.start", { requestId, collection, dbt, queryHash: diagnosticHash(searchWord), queryLength: searchWord.length, endpointHost: "www.ntis.go.kr", endpointPath, timeoutMs: NTIS_TIMEOUT_MS });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NTIS_TIMEOUT_MS);
  const url = new URL(NTIS_ENDPOINT);
  url.search = new URLSearchParams({
    apprvKey: apiKey, userId: "", collection, SRWR: searchWord, searchFd: "",
    displayCnt: String(MAX_NTIS_RESULTS_PER_COLLECTION), startPosition: "1", naviCount: "10", searchRnkn: "", boostquery: "",
    addQuery: `DBT=${dbt}`
  }).toString();
  try {
    const response = await fetch(url, { headers: {
      Accept: "application/xml,text/xml,text/html;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      Referer: "https://www.ntis.go.kr/",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
    }, signal: controller.signal });
    const xml = await readCappedResponse(response, MAX_NTIS_RESPONSE_BYTES);
    diagnosticLog("ntis.response", { requestId, collection, status: response.status, ok: response.ok, contentType: response.headers.get("content-type") || "", responseBytes: Buffer.byteLength(xml), elapsedMs: Date.now() - startedAt });
    if (!response.ok) {
      const ntisMessage = /<(?:resMsg|resultMsg|message|errorMessage)\b[^>]*>\s*([^<]+)\s*<\/(?:resMsg|resultMsg|message|errorMessage)>/i.exec(xml)?.[1]?.trim();
      throw new Error(`HTTP ${response.status}${ntisMessage ? `: ${ntisMessage.slice(0, 120)}` : ""}`);
    }
    return parseNtisXml(collection, xml);
  } catch (error) {
    const normalized = error.name === "AbortError" ? new Error("요청 시간 초과") : /^(?:HTTP \d+|NTIS)/.test(String(error.message || "")) ? error : new Error("NTIS 연결 오류");
    diagnosticLog("ntis.error", { requestId, collection, dbt, elapsedMs: Date.now() - startedAt, error: diagnosticError(normalized) });
    throw normalized;
  } finally { clearTimeout(timer); }
}

async function handleNtisAchievements(request, response) {
  const requestId = diagnosticId();
  diagnosticLog("ntis.request.received", { requestId, method: request.method });
  let body = {};
  try { body = await readJsonBody(request, 32 * 1024); }
  catch (error) { diagnosticLog("ntis.request.error", { requestId, error: diagnosticError(error) }); return sendJson(response, error.statusCode || 400, { success: false, results: [], counts: {}, warnings: [error.message], source: { provider: "NTIS", endpoint: "natRnDAllSearch", status: "invalid-request" } }); }
  const project = body?.project && typeof body.project === "object" && !Array.isArray(body.project) ? body.project : body;
  const name = cleanString(project?.name, 200).trim();
  const organization = cleanString(project?.organization, 160).trim();
  const projectId = cleanString(project?.id || project?.projectId || project?.ntisId, 100).trim();
  // NTIS SRWR accepts a simple keyword expression; do not send organization/id punctuation.
  const searchWord = normalizeNtisSearchWord(name);
  const queriedAt = new Date().toISOString();
  const emptyCounts = Object.fromEntries(Object.keys(NTIS_COLLECTIONS).map((key) => [key, 0]));
  if (!process.env.NTIS_API_KEY) {
    return sendJson(response, 200, { success: true, results: [], counts: emptyCounts, warnings: ["NTIS_API_KEY가 설정되지 않아 성과 근거 없이 분석을 계속합니다."], source: { provider: "NTIS", endpoint: "natRnDAllSearch", status: "not-configured", queriedAt, query: searchWord } });
  }
  if (!name) {
    return sendJson(response, 200, { success: true, results: [], counts: emptyCounts, warnings: ["과제명이 없어 NTIS 성과 조회를 건너뛰었습니다."], source: { provider: "NTIS", endpoint: "natRnDAllSearch", status: "skipped", queriedAt, query: searchWord } });
  }
  if (process.env.NTIS_PROXY_URL) {
    const proxyStartedAt = Date.now();
    try {
      const proxyResponse = await fetch(process.env.NTIS_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Secret": process.env.NTIS_PROXY_SECRET || "" },
        body: JSON.stringify({ project: { name } }),
        signal: AbortSignal.timeout(NTIS_TIMEOUT_MS)
      });
      const proxyBody = await proxyResponse.json().catch(() => ({}));
      diagnosticLog("ntis.proxy.response", { requestId, status: proxyResponse.status, ok: proxyResponse.ok, elapsedMs: Date.now() - proxyStartedAt });
      if (!proxyResponse.ok || proxyBody.success === false) {
        return sendJson(response, 200, { success: true, errorCategory: "ntis", requestId, results: [], counts: emptyCounts, warnings: ["한국 리전 NTIS 어댑터 조회에 실패해 성과 근거 없이 분석을 계속합니다."], source: { provider: "NTIS", endpoint: "seoul-adapter", status: "unavailable", queriedAt } });
      }
      return sendJson(response, 200, { ...proxyBody, requestId, source: { ...(proxyBody.source || {}), provider: "NTIS", endpoint: "seoul-adapter", status: "available", queriedAt } });
    } catch (error) {
      diagnosticLog("ntis.proxy.error", { requestId, elapsedMs: Date.now() - proxyStartedAt, error: diagnosticError(error) });
      return sendJson(response, 200, { success: true, errorCategory: "ntis", requestId, results: [], counts: emptyCounts, warnings: ["한국 리전 NTIS 어댑터에 연결하지 못해 성과 근거 없이 분석을 계속합니다."], source: { provider: "NTIS", endpoint: "seoul-adapter", status: "unavailable", queriedAt } });
    }
  }
  const entries = Object.entries(NTIS_COLLECTIONS);
  const settled = await Promise.allSettled(entries.map(async ([collection, dbt]) => [collection, await fetchNtisCollection(collection, dbt, searchWord, process.env.NTIS_API_KEY, requestId)]));
  const results = [];
  const counts = { ...emptyCounts };
  const warnings = [];
  settled.forEach((outcome, index) => {
    const collection = entries[index][0];
    if (outcome.status === "fulfilled") {
      counts[collection] = outcome.value[1].results.length;
      results.push(...outcome.value[1].results);
    } else warnings.push(`${collection} 조회 실패: ${cleanString(outcome.reason?.message, 160) || "알 수 없는 오류"}`);
  });
  const failed = warnings.length;
  const status = failed === entries.length ? "unavailable" : failed ? "partial" : results.length ? "available" : "empty";
  if (status === "empty") warnings.push("검색 조건에 맞는 NTIS 성과가 없어 수동 입력과 첨부자료만으로 분석합니다.");
  return sendJson(response, 200, { success: true, errorCategory: status === "unavailable" || status === "partial" ? "ntis" : undefined, requestId, results, counts, warnings, source: { provider: "NTIS", endpoint: "natRnDAllSearch", status, queriedAt, query: searchWord, collections: Object.keys(NTIS_COLLECTIONS) } });
}

const AGENT_ORDER = ["technology", "industry", "policy", "challenger", "transition", "final"];
const AGENT_DEFINITIONS = {
  technology: { name: "Technology", subtitle: "기술 경쟁력 분석", role: "기술성숙도, 목표성능 달성, 기술병목, 경쟁·대체기술, 추가 R&D 필요성을 독립적으로 판단한다.", criteria: "기술성숙도, 핵심기술 확보, 실제 목표성능 달성 여부, 미해결 기술이슈, 경쟁·대체기술 대비 수준, 기술세대 변화·개발속도, 상호운용성·확장성, 실험실-실제환경 격차, 추가 R&D·실증 필요성", boundary: "시장성·정책 필요성을 독립 판단하지 않는다. 논문·특허 수만으로 기술우위를 판단하지 않고, 목표성능과 실제 달성성능을 혼동하지 않는다.", required: "기술적 NEXT, 목표 대비 달성 여부, 기술병목, 경쟁·대체기술, 근거 부족·확인 필요 항목" , sources: "종료보고서·시험성적서·성능검증자료; 3GPP·ITU·ETSI·IEEE·TTA; KIPRIS·WIPO·Espacenet; IEEE Xplore·ACM·ScienceON; 경쟁기업 공식 기술자료; NTIS; 증권사 기술·산업 리서치" },
  industry: { name: "Industry", subtitle: "시장·산업 분석", role: "실제 산업수요, 시장성숙도, 기업투자, 제품·서비스, 경쟁구조, 민간주도 가능성을 독립적으로 판단한다.", criteria: "실제 수요기업, 제품·서비스 상용화, 도입·구매·계약·납품·실증, 민간투자, 경쟁구조, 공급망, 기술 채택속도, 국내기업 경쟁력, 민간주도 지속 가능성, 사업화 병목", boundary: "시장규모만으로 산업성을 판단하지 않는다. 공동연구·MOU를 실제 수요·구매·계약으로 간주하지 않으며, 기술성숙도와 정부지원 필요성을 독립 판단하지 않는다.", required: "산업적 NEXT, 실제 수요·상용화 증거, 투자·경쟁·공급망, 사업화 병목, 근거 부족·확인 필요 항목", sources: "기업 공식자료·제품자료; DART·IR·공시; 도입·납품·계약·실증사례; CAPEX 발표; KOTRA·KISDI·NIPA; 무역·나라장터·산업협회; Gartner·IDC·Omdia; 증권사 산업·기업·테마 리서치" },
  policy: { name: "Policy", subtitle: "정책 부합성 분석", role: "국가전략 부합성, 정부개입 필요성, 공공성, 시장실패, 기존지원 중복, 법·제도·표준환경을 독립적으로 판단한다.", criteria: "국가전략 부합성, 정부개입 필요성, 시장실패, 전략기술·공급망·경제안보, 공공·사회적 파급효과, 기존 정부지원사업 중복성, 민간대체 가능성, 법·제도·규제 변화, 표준·인증환경, 주요국 정책 변화", boundary: "국가전략 포함만으로 추가 지원을 결론내리지 않는다. 과거 지원만으로 후속 R&D를 추천하지 않으며, 선언적 정책문구를 지원근거로 보지 않는다. 기존 지원·민간투자 가능성 검토 없이 정부개입을 결론내리지 않고 기술성숙도·시장규모를 독립 판단하지 않는다.", required: "정책적 NEXT, 정부개입·시장실패 판단, 공공성, 중복성, 법·제도·표준환경, 주요국 정책, 근거 부족·확인 필요 항목", sources: "관계부처; 국가전략·기본계획·시행계획; 국가 R&D 투자방향·예산; 국가법령정보센터; 국가기술표준원·TTA; NTIS; KISTEP·STEPI·KISDI; 국회예산정책처·입법조사처; 미국·EU·일본 정부자료; 증권사 리서치(보조자료)" },
  challenger: { name: "Challenger", subtitle: "반론·취약점 검증", role: "앞선 세 진단의 논리적 비약, 근거 부족, 상충 주장과 확증편향을 검증한다.", criteria: "주장-근거 연결, Agent 간 불일치, 최신성·신뢰성, 반대근거, 인과와 상관 혼동, 정부지원 논리 비약, 낙관·비관 편향", boundary: "새 결론을 임의로 만들거나 반대를 위한 반대를 하지 않고 최종 NEXT를 단독 결정하지 않는다.", required: "핵심 반론, 충돌지점, 약한 주장, 검증 질문, 판단이 뒤집힐 조건" },
  transition: { name: "Transition", subtitle: "전환 경로 설계", role: "진단과 검증을 바탕으로 현실적인 후속 전환 후보 2~3개와 선결조건·병목을 설계한다.", criteria: "TRL 적합성, 실제 수요, 민간투자, 실증, 표준·인증, 기술이전, 후속 R&D, 정책수단 적합성, 핵심 병목", boundary: "사업 실행이나 특정 기업 이전을 결정하지 않고 새 사실을 만들거나 한 경로를 강제하지 않는다. 근거 부족은 '추가 판단 필요'로 쓴다.", required: "후보 경로 2~3개, 경로별 선결조건, 병목, 추가 정보" },
  final: { name: "NEXT Synthesizer", subtitle: "통합 판단 및 권고", role: "후보 중 주요 NEXT 하나와 대안 1~2개, 이유, 신뢰도와 다음 행동을 제시한다.", criteria: "병목 해결 적합성, 선행조건, 전환 준비도, 판단 일관성, Challenger 결과, 근거 신뢰도, 경로 간 순차·병행 관계", boundary: "근거를 만들거나 점수만으로 선정하지 않고, 반론·미충족 조건을 무시하거나 근거 부족 상태에서 결정을 강제하지 않는다.", required: "주요 NEXT, 대안, 선정·제외 이유, 신뢰도, 다음 행동" }
};

function cleanString(value, maxLength) {
  return typeof value === "string" ? value.replace(/\0/g, "").slice(0, maxLength) : "";
}

function normalizeNtisSearchWord(value) {
  return cleanString(value, 4000)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function redactSecrets(value, apiKey) {
  const text = String(value || "");
  return text
    .split(apiKey).join("[REDACTED_OPENAI_KEY]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_OPENAI_KEY]")
    .replace(/((?:OPENAI|NTIS)_API_KEY\s*[:=]\s*)[^\s'\";,]+/gi, "$1[REDACTED]");
}

function normalizeInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("JSON 객체가 필요합니다."), { statusCode: 400 });
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) throw Object.assign(new Error("OpenAI API Key가 필요합니다."), { statusCode: 400 });
  const requested = body.agents === undefined ? AGENT_ORDER : body.agents;
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > MAX_AGENT_COUNT) throw Object.assign(new Error(`agents는 1~${MAX_AGENT_COUNT}개 배열이어야 합니다.`), { statusCode: 400 });
  const agents = [...new Set(requested.map((value) => cleanString(value, 32).toLowerCase()))];
  if (agents.length !== requested.length || agents.some((agent) => !AGENT_DEFINITIONS[agent])) throw Object.assign(new Error(`agents는 중복 없이 ${AGENT_ORDER.join(", ")}만 사용할 수 있습니다.`), { statusCode: 400 });
  const suppliedInput = body.analysisInput && typeof body.analysisInput === "object" && !Array.isArray(body.analysisInput) ? body.analysisInput : {};
  const sourceTarget = suppliedInput.analysisTarget && typeof suppliedInput.analysisTarget === "object"
    ? suppliedInput.analysisTarget
    : suppliedInput.targetProject && typeof suppliedInput.targetProject === "object"
      ? suppliedInput.targetProject
      : body.analysisTarget && typeof body.analysisTarget === "object" ? body.analysisTarget : (body.project || {});
  const targetProject = {
    id: redactSecrets(cleanString(sourceTarget.id || sourceTarget.projectId, 100), apiKey),
    name: redactSecrets(cleanString(sourceTarget.name, 200), apiKey), field: redactSecrets(cleanString(sourceTarget.field, 100), apiKey),
    organization: redactSecrets(cleanString(sourceTarget.organization, 160), apiKey)
  };
  const sourceReference = suppliedInput.ntisReference || suppliedInput.sources?.ntisReference || body.ntisReference || (body.project?.ntisId ? { id: body.project.ntisId } : null);
  const ntisReference = sourceReference && typeof sourceReference === "object" ? {
    id: redactSecrets(cleanString(sourceReference.id, 100), apiKey), title: redactSecrets(cleanString(sourceReference.title, 240), apiKey),
    org: redactSecrets(cleanString(sourceReference.org, 160), apiKey), period: redactSecrets(cleanString(sourceReference.period, 100), apiKey),
    similarity: Number.isFinite(sourceReference.similarity) ? Math.max(0, Math.min(100, sourceReference.similarity)) : null
  } : null;
  const sourceAchievements = Array.isArray(suppliedInput.ntisAchievements) ? suppliedInput.ntisAchievements : Array.isArray(suppliedInput.sources?.ntisAchievements) ? suppliedInput.sources.ntisAchievements : Array.isArray(body.ntisAchievements) ? body.ntisAchievements : [];
  const ntisAchievements = sourceAchievements.slice(0, 30).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const normalized = {};
    for (const field of ["collection", "type", "id", "title", "projectId", "projectName", "organization", "year", "authors"]) {
      const value = redactSecrets(cleanString(item[field], field === "title" || field === "projectName" ? 500 : 240), apiKey);
      if (value) normalized[field] = value;
    }
    return normalized;
  }).filter(Boolean);
  const sourceReport = suppliedInput.reportContent && typeof suppliedInput.reportContent === "object" ? suppliedInput.reportContent : body.reportContent && typeof body.reportContent === "object" ? body.reportContent : (body.report && typeof body.report === "object" && !Array.isArray(body.report) ? body.report : null);
  const reportContent = sourceReport ? {
    name: redactSecrets(cleanString(sourceReport.name, 260), apiKey), type: redactSecrets(cleanString(sourceReport.type, 120), apiKey), extension: redactSecrets(cleanString(sourceReport.extension, 16), apiKey),
    extractionStatus: redactSecrets(cleanString(sourceReport.extractionStatus, 32), apiKey), parser: redactSecrets(cleanString(sourceReport.parser, 40), apiKey),
    size: Number.isFinite(sourceReport.size) ? Math.max(0, Math.trunc(sourceReport.size)) : null,
    lastModified: Number.isFinite(sourceReport.lastModified) ? Math.trunc(sourceReport.lastModified) : null,
    extractedLength: Number.isFinite(sourceReport.extractedLength) ? Math.max(0, Math.trunc(sourceReport.extractedLength)) : null,
    truncated: Boolean(sourceReport.truncated),
    warnings: Array.isArray(sourceReport.warnings) ? sourceReport.warnings.slice(0, 8).map((item) => redactSecrets(cleanString(item, 300), apiKey)) : [],
    content: redactSecrets(cleanString(sourceReport.content, MAX_REPORT_CHARS), apiKey)
  } : null;
  const suppliedPrior = body.priorResults && typeof body.priorResults === "object" && !Array.isArray(body.priorResults) ? body.priorResults : {};
  const priorResults = {};
  for (const agent of AGENT_ORDER) if (suppliedPrior[agent] && typeof suppliedPrior[agent] === "object") priorResults[agent] = normalizeAgentResult(agent, suppliedPrior[agent]);
  return { apiKey, agents, priorResults, analysisInput: { targetProject, sources: { ntisReference, ntisAchievements }, reportContent } };
}

function safeProviderMessage(status) {
  if (status === 401) return "OpenAI가 API Key를 인증하지 못했습니다.";
  if (status === 429) return "OpenAI 요청 한도 또는 결제 한도에 도달했습니다.";
  if (status >= 500) return "OpenAI 서비스가 일시적으로 응답하지 않습니다.";
  return "OpenAI 분석 요청이 거부되었습니다.";
}

function capList(value, itemLimit = 4, stringLimit = 320) {
  return Array.isArray(value) ? value.slice(0, itemLimit).map((item) => cleanString(item, stringLimit)).filter(Boolean) : [];
}

function compactAgentResult(agentKey, result, tight = false) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const stringLimit = tight ? 260 : 420;
  const itemLimit = tight ? 3 : 4;
  const compact = {
    score: Number.isFinite(result.score) ? Math.max(0, Math.min(100, Math.round(result.score))) : 0,
    summary: cleanString(result.summary, tight ? 600 : 900),
    strengths: capList(result.strengths, itemLimit, stringLimit),
    risks: capList(result.risks, itemLimit, stringLimit),
    insight: cleanString(result.insight, tight ? 500 : 800)
  };
  if (["technology", "industry", "policy"].includes(agentKey)) {
    compact.conclusion = cleanString(result.conclusion, tight ? 500 : 800);
    compact.keyFindings = capList(result.keyFindings, itemLimit, stringLimit);
    compact.uncertainties = capList(result.uncertainties, itemLimit, stringLimit);
    compact.bottlenecks = capList(result.bottlenecks, itemLimit, stringLimit);
    compact.nextCandidates = capList(result.nextCandidates, itemLimit, stringLimit);
    compact.evidence = Array.isArray(result.evidence) ? result.evidence.slice(0, tight ? 2 : 4).map((item) => ({
      claim: cleanString(item?.claim, stringLimit), source: cleanString(item?.source, 120), publishedDate: cleanString(item?.publishedDate, 40), url: cleanString(item?.url, 500), sourceGrade: cleanString(item?.sourceGrade, 20),
      sourceType: cleanString(item?.sourceType, 80), pageOrId: cleanString(item?.pageOrId, 100),
      certainty: cleanString(item?.certainty, 20)
    })) : [];
  } else if (agentKey === "challenger") {
    compact.overallAssessment = cleanString(result.overallAssessment, tight ? 600 : 900);
    compact.crossAgentConflicts = capList(result.crossAgentConflicts, itemLimit, stringLimit);
    compact.critiques = {};
    for (const domain of ["technology", "industry", "policy"]) {
      const critique = result.critiques?.[domain] || {};
      compact.critiques[domain] = {
        verdict: cleanString(critique.verdict, stringLimit),
        counterArguments: capList(critique.counterArguments, tight ? 2 : 3, stringLimit),
        weakEvidence: capList(critique.weakEvidence, tight ? 2 : 3, stringLimit),
        reversalConditions: capList(critique.reversalConditions, 2, stringLimit)
      };
    }
  } else if (agentKey === "transition") {
    compact.routeCandidates = Array.isArray(result.routeCandidates) ? result.routeCandidates.slice(0, 3).map((route) => ({
      route: cleanString(route?.route, 120), rationale: cleanString(route?.rationale, stringLimit),
      preconditions: capList(route?.preconditions, 3, stringLimit), bottleneck: cleanString(route?.bottleneck, stringLimit),
      actions: capList(route?.actions, 4, stringLimit), evidence: capList(route?.evidence, 3, stringLimit),
      missingData: capList(route?.missingData, 3, stringLimit)
    })) : [];
    compact.recommendedRoute = cleanString(result.recommendedRoute, 120);
  }
  return compact;
}

function compactPriorResults(priorResults, agentKey) {
  const source = priorResults && typeof priorResults === "object" && !Array.isArray(priorResults) ? priorResults : {};
  const allowed = agentKey === "challenger"
    ? ["technology", "industry", "policy"]
    : agentKey === "transition"
      ? ["technology", "industry", "policy", "challenger"]
      : agentKey === "final" ? ["technology", "industry", "policy", "challenger", "transition"] : [];
  const compact = {};
  for (const key of allowed) {
    const value = compactAgentResult(key, source[key], agentKey === "final" || (agentKey === "transition" && key !== "challenger"));
    if (value) compact[key] = value;
  }
  return compact;
}

function compactPromptInput(input, agentKey) {
  const later = ["transition", "final"].includes(agentKey);
  const reportLimit = agentKey === "final" ? 2500 : agentKey === "transition" ? 4500 : agentKey === "challenger" ? 8000 : 16000;
  const report = input.analysisInput.reportContent;
  return {
    analysisTarget: input.analysisInput.targetProject,
    referenceSources: {
      ntisReference: input.analysisInput.sources.ntisReference,
      ntisAchievements: input.analysisInput.sources.ntisAchievements.slice(0, later ? 6 : 12)
    },
    reportContent: report ? { ...report, warnings: capList(report.warnings, 3, 180), content: cleanString(report.content, reportLimit) } : null
  };
}

function promptFor(agentKey, input, priorResults) {
  const definition = AGENT_DEFINITIONS[agentKey];
  const evidence = { ...compactPromptInput(input, agentKey), priorAgentResults: compactPriorResults(priorResults, agentKey) };
  const domainContract = "Technology/Industry/Policy는 서로의 결과를 보지 않고 analysisTarget·종료보고서·NTIS 참고성과와 자기 분야 공개자료만으로 독립 수행한다. 핵심 주장은 가능하면 서로 다른 출처 2개 이상으로 교차검증한다. 모든 핵심 evidence에는 claim, source, publishedDate, url, sourceGrade(A/B/C/D), certainty, sourceType, pageOrId를 남긴다. 출처 우선순위는 정부·공공·표준기관·공식 기업자료·원 논문·특허(A) > 전문연구기관·학술DB·증권사 리서치(B) > 시장조사기관·전문매체(C) > 일반뉴스·블로그(D)이며 증권사 자료는 단독 핵심근거로 쓰지 않는다. 근거가 부족하면 추정하지 말고 '근거 부족', '확인 필요', '판단 불가'로 표시한다. conclusion(판정), keyFindings 3~6개, evidence 3~6개, uncertainties 3~5개, bottlenecks 2~4개, nextCandidates 2~4개, dataRequests 2~5개, confidenceRationale을 구체적으로 작성한다.";
  const challengerContract = "Challenger는 critiques.technology, critiques.industry, critiques.policy를 모두 작성한다. 각 도메인에 verdict, counterArguments 2~4개, weakEvidence 2~4개, verificationQuestions 2~4개, reversalConditions 1~3개를 제공하고, crossAgentConflicts, overallAssessment, confidenceRationale을 작성한다.";
  const transitionContract = "Transition은 routeCandidates에 서로 구별되는 후보 경로 2~3개를 작성한다. 각 후보는 route, rationale, preconditions, bottleneck, actions, evidence, missingData를 모두 포함한다. recommendedRoute는 후보 route 중 하나이거나 근거가 부족하면 '추가 판단 필요'다. 병목과 행동은 추상어 대신 대상 과제에서 실제로 확인·검증할 항목을 명시한다.";
  const finalContract = "NEXT Synthesizer는 Transition 후보 중 하나를 선택하되 Challenger가 기술성숙도·산업경쟁력의 취약점을 지적했거나 Transition 추천 경로가 기술이전과 다르면 기술이전을 최종 NEXT로 선택하지 않는다. 이 경우 primaryNext는 반드시 '추가 판단 필요' 또는 취약점을 해결하는 후속 R&D·실증 경로로 제한하고, 선결조건과 재평가 조건을 명시한다. primaryNext는 Transition의 recommendedRoute 및 Challenger 반론과 논리적으로 일치해야 하며, 서로 충돌하면 결정을 강제하지 않는다. primaryNext를 허용된 6개 경로 중 하나로 선택하고, bottleneck에 구체적인 단일 핵심 병목, bottleneckEvidence에 그 판단 근거, decision에 해당 경로를 택한 이유를 쓴다. preconditions 2~5개, executionPlan 3~6개(각 action, owner, time, KPI), rejectedAlternatives 1~4개(route, reason), confidence 0~100, confidenceRationale, reassessmentTriggers 1~4개를 모두 작성한다. 입력 근거가 owner/time/KPI를 뒷받침하지 않으면 해당 값은 반드시 '확인 필요'로 쓴다. '병목 해결이 필요합니다'처럼 병목명과 경로가 없는 일반론은 금지한다.";
  const contract = ["technology", "industry", "policy"].includes(agentKey) ? domainContract : agentKey === "challenger" ? challengerContract : agentKey === "transition" ? transitionContract : finalContract;
  const prompt = [`당신은 R&D NEXT의 ${definition.name} Agent다.`, `역할: ${definition.role}`, `판단 기준: ${definition.criteria}`, `중점 출처: ${definition.sources || "제공된 1차·공식 자료"}`, `금지/경계: ${definition.boundary}`, `필수 관점: ${definition.required}`, "[독립 실행 규칙] Technology·Industry·Policy는 서로의 결과나 평가를 입력으로 받지 않는다. 현재 Agent는 자기 역할 범위 밖의 기술성·산업성·정책 필요성을 대신 판단하지 않는다.", "[최우선 대상 규칙] analysisTarget만 분석 대상이다. 모든 진단, 점수, 요약, NEXT 제안의 주어는 analysisTarget이어야 한다.", "referenceSources.ntisReference와 referenceSources.ntisAchievements는 참고·보강용 증거일 뿐 분석 대상이 아니다. NTIS 성과의 제목·기관·내용을 대상 정보에 대입하거나 분석 대상을 NTIS 항목으로 바꾸지 않는다.", "reportContent는 analysisTarget에 사용자가 첨부한 별도 종료보고서 근거다. NTIS 근거와 혼동하지 않는다.", "아래 제공 입력과 허용된 공개자료만 증거로 사용한다. 외부 사실, 수치, 출처, 기업, 정책, 페이지 번호를 지어내지 않는다.", "확인할 수 없는 사실은 추론으로 메우지 말고 해당 필드에 '근거 부족', '확인 필요', '판단 불가'를 명시한다.", "score는 증거 충실도와 준비도를 종합한 0~100 정수다. Technology는 기술성숙도·실제성능·병목·대체기술·실증준비를, Industry는 실제수요·구매/도입·민간투자·경쟁·공급망을, Policy는 전략부합·정부개입 필요·시장실패·공공성·법제도·중복성을 각각 평가한다. 각 항목을 0~20으로 내부 평가해 합산하고, 확인되지 않은 항목은 보수적으로 0~5점으로 둔다. 세 Agent 점수가 같으면 근거 범위·핵심발견·불확실성 수를 비교하는 결정적 동점해소를 적용하므로 최종 표시 점수는 서로 달라야 한다.", "summary, strengths, risks, insight는 기존 클라이언트 호환을 위해 반드시 함께 출력한다.", contract, "한국어로만 답하고 JSON Schema에 맞는 JSON 객체만 출력한다.", `명시적으로 구분된 증거 입력:\n${JSON.stringify(evidence)}`].join("\n");
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;
  let serialized = JSON.stringify(evidence);
  const prefix = prompt.slice(0, prompt.length - serialized.length);
  if (evidence.reportContent) evidence.reportContent.content = "[프롬프트 한도로 보고서 본문 생략]";
  evidence.referenceSources.ntisAchievements = evidence.referenceSources.ntisAchievements.slice(0, 3);
  serialized = JSON.stringify(evidence);
  if (prefix.length + serialized.length <= MAX_PROMPT_CHARS) return prefix + serialized;
  evidence.priorAgentResults = Object.fromEntries(Object.entries(evidence.priorAgentResults).map(([key, value]) => [key, {
    score: value.score, summary: cleanString(value.summary, 240), insight: cleanString(value.insight, 180), risks: capList(value.risks, 2, 160),
    ...(key === "transition" ? { recommendedRoute: cleanString(value.recommendedRoute, 100), routeCandidates: Array.isArray(value.routeCandidates) ? value.routeCandidates.slice(0, 3).map((route) => ({ route: cleanString(route.route, 80), bottleneck: cleanString(route.bottleneck, 140), rationale: cleanString(route.rationale, 140) })) : [] } : {})
  }]));
  serialized = JSON.stringify(evidence);
  if (prefix.length + serialized.length <= MAX_PROMPT_CHARS) return prefix + serialized;
  return prefix + JSON.stringify({ analysisTarget: evidence.analysisTarget, truncationNotice: "프롬프트 안전 한도로 참고 근거를 생략했습니다." });
}

const stringSchema = { type: "string" };
const stringArraySchema = (minItems, maxItems) => ({ type: "array", items: stringSchema, minItems, maxItems });
const legacyProperties = {
  score: { type: "integer", minimum: 0, maximum: 100 }, summary: stringSchema,
  strengths: stringArraySchema(1, 6), risks: stringArraySchema(1, 6), insight: stringSchema
};
const legacyRequired = Object.keys(legacyProperties);
const evidenceItemSchema = {
  type: "object", additionalProperties: false,
  properties: { claim: stringSchema, source: stringSchema, publishedDate: stringSchema, url: stringSchema, sourceGrade: { type: "string", enum: ["A", "B", "C", "D", "확인 불가"] }, sourceType: stringSchema, pageOrId: stringSchema, certainty: { type: "string", enum: ["높음", "중간", "낮음", "확인 불가"] } },
  required: ["claim", "source", "publishedDate", "url", "sourceGrade", "sourceType", "pageOrId", "certainty"]
};
const critiqueSchema = {
  type: "object", additionalProperties: false,
  properties: { verdict: stringSchema, counterArguments: stringArraySchema(2, 4), weakEvidence: stringArraySchema(2, 4), verificationQuestions: stringArraySchema(2, 4), reversalConditions: stringArraySchema(1, 3) },
  required: ["verdict", "counterArguments", "weakEvidence", "verificationQuestions", "reversalConditions"]
};
const routeCandidateSchema = {
  type: "object", additionalProperties: false,
  properties: { route: stringSchema, rationale: stringSchema, preconditions: stringArraySchema(1, 5), bottleneck: stringSchema, actions: stringArraySchema(1, 6), evidence: stringArraySchema(1, 5), missingData: stringArraySchema(1, 5) },
  required: ["route", "rationale", "preconditions", "bottleneck", "actions", "evidence", "missingData"]
};
const executionActionSchema = {
  type: "object", additionalProperties: false,
  properties: { action: stringSchema, owner: stringSchema, time: stringSchema, KPI: stringSchema },
  required: ["action", "owner", "time", "KPI"]
};
const rejectedAlternativeSchema = {
  type: "object", additionalProperties: false,
  properties: { route: stringSchema, reason: stringSchema }, required: ["route", "reason"]
};

function outputSchemaFor(agentKey) {
  const properties = { ...legacyProperties };
  const required = [...legacyRequired];
  if (["technology", "industry", "policy"].includes(agentKey)) {
    Object.assign(properties, {
      conclusion: stringSchema, keyFindings: stringArraySchema(3, 6),
      evidence: { type: "array", items: evidenceItemSchema, minItems: 3, maxItems: 6 },
      uncertainties: stringArraySchema(3, 5), bottlenecks: stringArraySchema(2, 4),
      nextCandidates: stringArraySchema(2, 4), dataRequests: stringArraySchema(2, 5), confidenceRationale: stringSchema
    });
    required.push("conclusion", "keyFindings", "evidence", "uncertainties", "bottlenecks", "nextCandidates", "dataRequests", "confidenceRationale");
  } else if (agentKey === "challenger") {
    Object.assign(properties, {
      critiques: { type: "object", additionalProperties: false, properties: { technology: critiqueSchema, industry: critiqueSchema, policy: critiqueSchema }, required: ["technology", "industry", "policy"] },
      crossAgentConflicts: stringArraySchema(1, 6), overallAssessment: stringSchema, confidenceRationale: stringSchema
    });
    required.push("critiques", "crossAgentConflicts", "overallAssessment", "confidenceRationale");
  } else if (agentKey === "transition") {
    Object.assign(properties, {
      routeCandidates: { type: "array", items: routeCandidateSchema, minItems: 2, maxItems: 3 }, recommendedRoute: stringSchema
    });
    required.push("routeCandidates", "recommendedRoute");
  } else if (agentKey === "final") {
    Object.assign(properties, {
      primaryNext: { type: "string", enum: ["후속 R&D", "실증", "기술이전", "표준화", "민간주도 전환", "추가 판단 필요"] },
      bottleneck: stringSchema, bottleneckEvidence: stringArraySchema(1, 5), decision: stringSchema,
      preconditions: stringArraySchema(2, 5), executionPlan: { type: "array", items: executionActionSchema, minItems: 3, maxItems: 6 },
      rejectedAlternatives: { type: "array", items: rejectedAlternativeSchema, minItems: 1, maxItems: 4 },
      confidence: { type: "integer", minimum: 0, maximum: 100 }, confidenceRationale: stringSchema,
      reassessmentTriggers: stringArraySchema(1, 4)
    });
    required.push("primaryNext", "bottleneck", "bottleneckEvidence", "decision", "preconditions", "executionPlan", "rejectedAlternatives", "confidence", "confidenceRationale", "reassessmentTriggers");
  }
  return { type: "object", additionalProperties: false, properties, required };
}

function normalizeAgentResult(agentKey, value) {
  const definition = AGENT_DEFINITIONS[agentKey];
  const list = (items) => Array.isArray(items) ? items.slice(0, 6).map((item) => cleanString(item, 500)).filter(Boolean) : [];
  const score = Number.isFinite(value?.score) ? Math.max(0, Math.min(100, Math.round(value.score))) : 0;
  const result = { name: definition.name, subtitle: definition.subtitle, score, summary: cleanString(value?.summary, 1600) || "추가 판단 필요: 응답에 요약이 없습니다.", strengths: list(value?.strengths), risks: list(value?.risks), insight: cleanString(value?.insight, 1200) || "추가 판단 필요" };
  if (["technology", "industry", "policy"].includes(agentKey)) {
    result.conclusion = cleanString(value?.conclusion, 1200) || result.summary;
    result.keyFindings = list(value?.keyFindings);
    result.evidence = Array.isArray(value?.evidence) ? value.evidence.slice(0, 6).map((item) => ({
      claim: cleanString(item?.claim, 800) || "확인 불가", source: cleanString(item?.source, 300) || "확인 불가",
      sourceType: cleanString(item?.sourceType, 120) || "확인 불가", pageOrId: cleanString(item?.pageOrId, 160) || "확인 불가",
      certainty: ["높음", "중간", "낮음", "확인 불가"].includes(item?.certainty) ? item.certainty : "확인 불가"
    })) : [];
    result.uncertainties = list(value?.uncertainties); result.bottlenecks = list(value?.bottlenecks);
    result.nextCandidates = list(value?.nextCandidates); result.dataRequests = list(value?.dataRequests);
    result.confidenceRationale = cleanString(value?.confidenceRationale, 1200) || "추가 판단 필요";
  } else if (agentKey === "challenger") {
    const critique = (item) => ({ verdict: cleanString(item?.verdict, 1000) || "추가 판단 필요", counterArguments: list(item?.counterArguments), weakEvidence: list(item?.weakEvidence), verificationQuestions: list(item?.verificationQuestions), reversalConditions: list(item?.reversalConditions) });
    result.critiques = { technology: critique(value?.critiques?.technology), industry: critique(value?.critiques?.industry), policy: critique(value?.critiques?.policy) };
    result.crossAgentConflicts = list(value?.crossAgentConflicts);
    result.overallAssessment = cleanString(value?.overallAssessment, 1400) || result.summary;
    result.confidenceRationale = cleanString(value?.confidenceRationale, 1200) || "추가 판단 필요";
  } else if (agentKey === "transition") {
    result.routeCandidates = Array.isArray(value?.routeCandidates) ? value.routeCandidates.slice(0, 3).map((route) => ({
      route: cleanString(route?.route, 200) || "추가 판단 필요", rationale: cleanString(route?.rationale, 1200) || "추가 판단 필요",
      preconditions: list(route?.preconditions), bottleneck: cleanString(route?.bottleneck, 800) || "추가 판단 필요",
      actions: list(route?.actions), evidence: list(route?.evidence), missingData: list(route?.missingData)
    })) : [];
    result.recommendedRoute = cleanString(value?.recommendedRoute, 200) || "추가 판단 필요";
  } else if (agentKey === "final") {
    const allowedNext = ["후속 R&D", "실증", "기술이전", "표준화", "민간주도 전환", "추가 판단 필요"];
    result.primaryNext = allowedNext.includes(value?.primaryNext) ? value.primaryNext : "추가 판단 필요";
    const rawBottleneck = cleanString(value?.bottleneck, 800);
    result.bottleneck = !rawBottleneck || /^(?:핵심 )?병목(?:을|의)? 해결(?:이)? 필요(?:합니다|함)?[.!]?$/u.test(rawBottleneck) ? "추가 판단 필요: 구체적인 병목이 명시되지 않음" : rawBottleneck;
    result.bottleneckEvidence = list(value?.bottleneckEvidence);
    const rawDecision = cleanString(value?.decision, 1400);
    result.decision = rawDecision ? (rawDecision.includes(result.primaryNext) ? rawDecision : `${result.primaryNext} 선택: ${rawDecision}`) : `${result.bottleneck}을 기준으로 ${result.primaryNext} 경로를 검토해야 합니다.`;
    result.preconditions = list(value?.preconditions);
    result.executionPlan = Array.isArray(value?.executionPlan) ? value.executionPlan.slice(0, 6).map((item) => ({
      action: cleanString(item?.action, 600) || "확인 필요", owner: cleanString(item?.owner, 200) || "확인 필요",
      time: cleanString(item?.time, 200) || "확인 필요", KPI: cleanString(item?.KPI, 400) || "확인 필요"
    })) : [];
    result.rejectedAlternatives = Array.isArray(value?.rejectedAlternatives) ? value.rejectedAlternatives.slice(0, 4).map((item) => ({ route: cleanString(item?.route, 200) || "추가 판단 필요", reason: cleanString(item?.reason, 800) || "추가 판단 필요" })) : [];
    result.confidence = Number.isFinite(value?.confidence) ? Math.max(0, Math.min(100, Math.round(value.confidence))) : score;
    result.confidenceRationale = cleanString(value?.confidenceRationale, 1200) || "추가 판단 필요";
    result.reassessmentTriggers = list(value?.reassessmentTriggers);
  }
  return result;
}

function reconcileFinalResult(result, priorResults) {
  if (!result || typeof result !== "object") return result;
  const challenger = priorResults?.challenger || {};
  const transition = priorResults?.transition || {};
  const techVerdict = String(challenger.critiques?.technology?.verdict || "");
  const industryVerdict = String(challenger.critiques?.industry?.verdict || "");
  const recommended = String(transition.recommendedRoute || "");
  const routeMismatch = result.primaryNext === "기술이전" && recommended && !/(기술이전|기술 이전|상용화|민간)/u.test(recommended);
  const technologyBlocked = result.primaryNext === "기술이전" && /(부족|불확실|한계|취약|미흡|미성숙)/u.test(techVerdict);
  const industryBlocked = result.primaryNext === "민간주도 전환" && /(부족|불확실|한계|취약|미흡|미성숙)/u.test(industryVerdict);
  if (routeMismatch || technologyBlocked || industryBlocked) {
    const priorNext = result.primaryNext;
    result.primaryNext = fallbackNextRoute(transition.recommendedRoute, transition.routeCandidates);
    result.confidence = Math.min(Number.isFinite(result.confidence) ? result.confidence : 0, 49);
    result.decision = `Challenger의 취약점과 Transition 추천 경로가 ${priorNext}와 일치하지 않아 ${result.primaryNext}를 잠정 후속분야로 제시합니다. 추가 확인 후 확정해야 합니다.`;
    result.confidenceRationale = `${result.confidenceRationale || ""} Challenger 반론 또는 Transition 경로와의 불일치가 확인되어 보류했습니다.`.trim();
    result.reassessmentTriggers = [...new Set([...(Array.isArray(result.reassessmentTriggers) ? result.reassessmentTriggers : []), "기술성숙도·산업경쟁력 취약점 해소 및 전환경로 적합성 재검증"])].slice(0, 4);
  }
  if (result.primaryNext === "추가 판단 필요") {
    result.primaryNext = fallbackNextRoute(transition.recommendedRoute, transition.routeCandidates);
    result.confidence = Math.min(Number.isFinite(result.confidence) ? result.confidence : 0, 49);
    result.decision = `${result.primaryNext}를 잠정 후속분야로 제시합니다. 세부 전환 여부는 추가 확인이 필요합니다.`;
    result.confidenceRationale = `${result.confidenceRationale || ""} 구체적 경로 확정 근거가 부족해 잠정 후속분야로 표시했습니다.`.trim();
  }
  return result;
}

function fallbackNextRoute(recommended, candidates) {
  const text = [recommended, ...(Array.isArray(candidates) ? candidates.map((x) => x?.route) : [])].join(" ");
  if (/실증/u.test(text)) return "실증";
  if (/표준/u.test(text)) return "표준화";
  return "후속 R&D";
}

function ensureUniqueDiagnosisScores(results) {
  const keys = ["technology", "industry", "policy"].filter((key) => results[key]);
  const groups = new Map();
  keys.forEach((key) => { const score = Number(results[key].score) || 0; if (!groups.has(score)) groups.set(score, []); groups.get(score).push(key); });
  for (const [score, group] of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const signal = (key) => (results[key].evidence?.length || 0) * 3 + (results[key].keyFindings?.length || 0) * 2 - (results[key].uncertainties?.length || 0);
      return signal(b) - signal(a) || ["technology", "policy", "industry"].indexOf(a) - ["technology", "policy", "industry"].indexOf(b);
    });
    group.forEach((key, index) => { results[key].score = Math.max(0, Math.min(100, score - index)); results[key].scoreTieBreak = index ? "동점 해소: 근거 범위·핵심발견·불확실성 수 기준" : "원점수"; });
  }
  return results;
}

async function openAIRequest(apiKey, agentKey, input, priorResults, useStrictSchema) {
  const timeoutMs = OPENAI_PHASE_TIMEOUT_MS[agentKey] || OPENAI_TIMEOUT_MS;
  const requestId = input?.diagnosticId;
  const startedAt = Date.now();
  diagnosticLog("openai.request.start", { requestId, agent: agentKey, model: OPENAI_MODEL, timeoutMs });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const responseFormat = useStrictSchema
      ? { type: "json_schema", json_schema: { name: `${agentKey}_analysis`, strict: true, schema: outputSchemaFor(agentKey) } }
      : { type: "json_object" };
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.1, max_tokens: OPENAI_MAX_TOKENS, response_format: responseFormat, messages: [{ role: "system", content: "Follow the supplied evidence and guardrails exactly. Never invent facts. Mark unknowns explicitly. Return only valid JSON." }, { role: "user", content: promptFor(agentKey, input, priorResults) }] }),
      signal: controller.signal
    });
    if (!response.ok) {
      await response.text().catch(() => "");
      diagnosticLog("openai.response", { requestId, agent: agentKey, status: response.status, ok: false, strictSchema: useStrictSchema, elapsedMs: Date.now() - startedAt });
      const error = new Error(safeProviderMessage(response.status));
      error.providerStatus = response.status;
      error.statusCode = response.status === 401 ? 401 : response.status === 429 ? 429 : 502;
      error.code = `OPENAI_${response.status}`;
      throw error;
    }
    diagnosticLog("openai.response", { requestId, agent: agentKey, status: response.status, ok: true, strictSchema: useStrictSchema, elapsedMs: Date.now() - startedAt });
    return response.json();
  } catch (error) {
    const normalized = error.name === "AbortError" ? Object.assign(new Error(`${AGENT_DEFINITIONS[agentKey].name} 단계가 제한 시간(${Math.round(timeoutMs / 1000)}초)을 초과했습니다.`), { statusCode: 504, code: "OPENAI_TIMEOUT" }) : error.statusCode || error.providerStatus ? error : Object.assign(new Error("OpenAI 서비스에 안전하게 연결하지 못했습니다."), { statusCode: 502, code: "OPENAI_CONNECTION_FAILED" });
    diagnosticLog("openai.error", { requestId, agent: agentKey, elapsedMs: Date.now() - startedAt, error: diagnosticError(normalized) });
    throw normalized;
  } finally { clearTimeout(timer); }
}

async function callOpenAI(apiKey, agentKey, input, priorResults) {
  let payload;
  try {
    payload = await openAIRequest(apiKey, agentKey, input, priorResults, true);
  } catch (error) {
    if (error.providerStatus !== 400) throw error;
    payload = await openAIRequest(apiKey, agentKey, input, priorResults, false);
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw Object.assign(new Error("OpenAI 응답에 분석 내용이 없습니다."), { statusCode: 502, code: "OPENAI_EMPTY_RESPONSE" });
  const jsonText = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed;
  try { parsed = JSON.parse(jsonText); } catch (_) { throw Object.assign(new Error("OpenAI 응답의 JSON 형식이 올바르지 않습니다."), { statusCode: 502, code: "OPENAI_INVALID_JSON" }); }
  return normalizeAgentResult(agentKey, parsed);
}

async function handleAgentRun(request, response) {
  let input;
  const results = {};
  let phase = "request";
  let stream = false;
  const emit = (event) => response.write(`${JSON.stringify(event)}\n`);
  try {
    const body = await readJsonBody(request);
    stream = body?.stream === true;
    input = normalizeInput(body);
    input.diagnosticId = diagnosticId();
    diagnosticLog("openai.request.received", { requestId: input.diagnosticId, agents: input.agents });
    Object.assign(results, input.priorResults);
    if (stream) response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" });
    const firstWave = input.agents.filter((agent) => ["technology", "industry", "policy"].includes(agent));
    phase = firstWave.length ? "diagnosis" : input.agents[0] || "request";
    if (stream && firstWave.length) emit({ type: "phase", phase: "diagnosis", status: "running", runningAgents: firstWave, completedAgents: AGENT_ORDER.filter((agent) => results[agent]) });
    const firstResults = await Promise.allSettled(firstWave.map(async (agent) => {
      if (stream) emit({ type: "progress", phase: "diagnosis", agent, status: "running", message: `${AGENT_DEFINITIONS[agent].name}가 입력자료와 근거를 구조화하는 중입니다.` });
      const result = await callOpenAI(input.apiKey, agent, input, {});
      if (stream) emit({ type: "agent", phase: "diagnosis", agent, status: "completed", result });
      return [agent, result];
    }));
    let firstFailure = null;
    firstResults.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") results[outcome.value[0]] = outcome.value[1];
      else if (!firstFailure) firstFailure = { agent: firstWave[index], error: outcome.reason };
    });
    if (firstFailure) {
      phase = firstFailure.agent;
      firstFailure.error.failedAgent = firstFailure.agent;
      throw firstFailure.error;
    }
    ensureUniqueDiagnosisScores(results);
    if (stream && firstWave.length) emit({ type: "phase", phase: "diagnosis", status: "completed", completedAgents: AGENT_ORDER.filter((agent) => results[agent]) });
    for (const agent of ["challenger", "transition", "final"]) if (input.agents.includes(agent)) {
      phase = agent;
      if (stream) {
        emit({ type: "phase", phase: agent, status: "running", runningAgents: [agent], completedAgents: AGENT_ORDER.filter((key) => results[key]) });
        emit({ type: "progress", phase: agent, agent, status: "running", message: `${AGENT_DEFINITIONS[agent].name}가 앞선 결과를 바탕으로 다음 판단을 구성하는 중입니다.` });
      }
      try {
        results[agent] = await callOpenAI(input.apiKey, agent, input, results);
        if (agent === "final") results[agent] = reconcileFinalResult(results[agent], results);
        if (stream) {
          emit({ type: "agent", phase: agent, agent, status: "completed", result: results[agent] });
          emit({ type: "phase", phase: agent, status: "completed", completedAgents: AGENT_ORDER.filter((key) => results[key]) });
        }
      }
      catch (error) { error.failedAgent = agent; throw error; }
    }
    if (stream) {
      emit({ type: "complete", success: true, model: OPENAI_MODEL, completedAgents: AGENT_ORDER.filter((agent) => results[agent]) });
      return response.end();
    }
    return sendJson(response, 200, { success: true, model: OPENAI_MODEL, results });
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 502;
    const safeMessage = input ? redactSecrets(cleanString(error.message, 300), input.apiKey) : cleanString(error.message, 300);
    const failedAgent = AGENT_DEFINITIONS[error.failedAgent] ? error.failedAgent : AGENT_DEFINITIONS[phase] ? phase : null;
    const safePhase = failedAgent ? AGENT_DEFINITIONS[failedAgent].name : phase === "diagnosis" ? "1차 진단" : "요청 검증";
    const errorCategory = error?.code?.startsWith("OPENAI_") || error?.providerStatus ? "openai" : "backend";
    const payload = {
      success: false, errorCategory, requestId: input?.diagnosticId, model: OPENAI_MODEL, partial: Object.keys(results).length > 0, results,
      completedAgents: AGENT_ORDER.filter((agent) => results[agent]),
      error: { code: error.code || "AGENT_RUN_FAILED", phase: safePhase, failedAgent, message: safeMessage || `${safePhase} 단계 분석에 실패했습니다.` }
    };
    if (stream && response.headersSent) {
      emit({ type: "error", ...payload });
      return response.end();
    }
    return sendJson(response, statusCode, payload);
  } finally { if (input) input.apiKey = ""; }
}

async function handleHwpxReport(request, response) {
  try {
    const body = await readJsonBody(request, 512 * 1024);
    const markdown = cleanString(body?.markdown, 450000).trim();
    if (!markdown) return sendJson(response, 400, { success: false, message: "보고서 내용이 없습니다." });
    // Never create a new HWPX here: that loses the Hancom-saved structure.
    // The mapper rejects any block addition/deletion or residual diff rather
    // than returning Kordoc's potentially partial patch.
    const { buildTemplateReport } = require("./hwpx-template-report");
    const generated = await buildTemplateReport(markdown, body?.projectName);
    const hwpx = generated.data;
    const projectName = cleanString(body?.projectName, 80).replace(/[\\\\/:*?"<>|\\r\\n]+/g, " ").trim() || "RND_NEXT";
    const filename = encodeURIComponent(`RND_NEXT_${projectName}.hwpx`);
    response.writeHead(200, {
      "Content-Type": "application/vnd.hancom.hwpx",
      "Content-Disposition": `attachment; filename="RND_NEXT_report.hwpx"; filename*=UTF-8''${filename}`,
      "X-HWPX-Mapping-Report": encodeURIComponent(JSON.stringify({ template: generated.mapping.template, applied: generated.mapping.applied.length, unmatched: generated.mapping.unmatched.length, validation: generated.mapping.validation?.ok === true })),
      "Cache-Control": "no-store"
    });
    return response.end(Buffer.from(hwpx));
  } catch (error) {
    const payload = { success: false, code: error.code || "HWPX_REPORT_FAILED", message: String(error.message || "HWPX 보고서 생성에 실패했습니다.").slice(0, 300) };
    if (error.mapping) payload.mapping = error.mapping;
    return sendJson(response, error.statusCode || (error.code === "HWPX_TEMPLATE_MAPPING_INCOMPLETE" ? 422 : 500), payload);
  }
}

function decodeFilename(value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

function parseMultipartFile(body, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || "");
  if (!boundaryMatch) {
    const error = new Error("multipart/form-data boundary가 없습니다.");
    error.statusCode = 400;
    throw error;
  }
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  let cursor = 0;
  while (cursor < body.length) {
    const boundaryStart = body.indexOf(boundary, cursor);
    if (boundaryStart < 0) break;
    const partStart = boundaryStart + boundary.length;
    if (body.subarray(partStart, partStart + 2).equals(Buffer.from("--"))) break;
    const headerStart = partStart + 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd < 0) break;
    const nextBoundary = body.indexOf(boundary, headerEnd + 4);
    if (nextBoundary < 0) break;
    const headers = body.subarray(headerStart, headerEnd).toString("utf8");
    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headers)?.[1] || "";
    const fieldName = /\bname="([^"]+)"/i.exec(disposition)?.[1];
    const encodedName = /\bfilename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const plainName = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
    if (fieldName === "document" && (encodedName || plainName)) {
      return { filename: decodeFilename(encodedName || plainName), data: body.subarray(headerEnd + 4, nextBoundary - 2) };
    }
    cursor = nextBoundary;
  }
  const error = new Error("document 파일 필드가 없습니다.");
  error.statusCode = 400;
  throw error;
}

function runKordoc(inputPath, requestId, extension) {
  const startedAt = Date.now();
  diagnosticLog("parser.request.start", { requestId, extension, parser: "kordoc", timeoutMs: PARSER_TIMEOUT_MS });
  return new Promise((resolve, reject) => {
    const localKordoc = path.join(ROOT, "node_modules", ".bin", "kordoc");
    const command = fsSync.existsSync(localKordoc) ? localKordoc : "npx";
    const args = fsSync.existsSync(localKordoc)
      ? [inputPath, "--format", "json"]
      : ["--yes", "--package", "kordoc", "--package", "pdfjs-dist", "kordoc", inputPath, "--format", "json"];
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, NO_UPDATE_NOTIFIER: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let stdoutSize = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const error = new Error("kordoc 파싱 제한 시간(120초)을 초과했습니다.");
      error.code = "PARSER_TIMEOUT";
      diagnosticLog("parser.timeout", { requestId, extension, elapsedMs: Date.now() - startedAt, error: diagnosticError(error) });
      finish(reject, error);
    }, PARSER_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdoutSize += chunk.length;
      if (stdoutSize > MAX_PARSER_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        const error = new Error("kordoc 출력이 허용 크기를 초과했습니다.");
        error.code = "PARSER_OUTPUT_TOO_LARGE";
        finish(reject, error);
      } else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      const currentSize = stderr.reduce((total, item) => total + item.length, 0);
      if (currentSize < 64 * 1024) stderr.push(chunk);
    });
    child.on("error", (error) => {
      diagnosticLog("parser.process.error", { requestId, extension, elapsedMs: Date.now() - startedAt, error: diagnosticError(error) });
      finish(reject, error);
    });
    child.on("close", (code, signal) => {
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const diagnostic = Buffer.concat(stderr).toString("utf8").trim();
      const outputLooksJson = output.startsWith("{") && output.endsWith("}");
      if (code !== 0 && !(code === null && outputLooksJson)) {
        const error = new Error(diagnostic || `kordoc가 종료 코드 ${code}${signal ? `, signal ${signal}` : ""}로 실패했습니다.`);
        error.code = "KORDOC_FAILED";
        diagnosticLog("parser.process.exit", { requestId, extension, exitCode: code, signal: signal || null, stderr: diagnostic.slice(0, 300), outputBytes: Buffer.byteLength(output), elapsedMs: Date.now() - startedAt, error: diagnosticError(error) });
        finish(reject, error);
      } else {
        diagnosticLog("parser.process.complete", { requestId, extension, exitCode: code, signal: signal || null, outputBytes: Buffer.byteLength(output), elapsedMs: Date.now() - startedAt, recoveredNullExit: code === null });
        finish(resolve, { output, diagnostic });
      }
    });
  });
}

function parseKordocJson(output) {
  try { return JSON.parse(output); } catch (_) {
    const start = output.indexOf("{");
    const end = output.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(output.slice(start, end + 1));
    throw new Error("kordoc JSON 출력을 해석할 수 없습니다.");
  }
}

async function handleDocumentParse(request, response) {
  const requestId = diagnosticId();
  diagnosticLog("parser.request.received", { requestId, method: request.method });
  let temporaryDirectory;
  try {
    const body = await readRequestBody(request);
    const upload = parseMultipartFile(body, request.headers["content-type"]);
    const extension = path.extname(upload.filename).slice(1).toLowerCase();
    if (!PARSABLE_EXTENSIONS.has(extension)) {
      return sendJson(response, 415, { success: false, extractionStatus: "unsupported", warnings: ["백엔드 kordoc 경로는 PDF, HWP, HWPX만 지원합니다."] });
    }
    if (!upload.data.length) {
      return sendJson(response, 400, { success: false, extractionStatus: "failed", warnings: ["업로드된 파일이 비어 있습니다."] });
    }
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rnd-next-kordoc-"));
    const inputPath = path.join(temporaryDirectory, `upload.${extension}`);
    await fs.writeFile(inputPath, upload.data, { mode: 0o600 });
    const result = await runKordoc(inputPath, requestId, extension);
    const parsed = parseKordocJson(result.output);
    const markdown = typeof parsed.markdown === "string" ? parsed.markdown : "";
    const warnings = result.diagnostic.split(/\r?\n/)
      .filter((line) => /⚠|warn|warning|주의|오류/i.test(line))
      .slice(0, 5)
      .map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 300));
    if (parsed.success === false) warnings.push(String(parsed.error || "kordoc가 문서를 파싱하지 못했습니다."));
    if (!markdown.trim()) warnings.push("파싱 결과에 추출된 Markdown 텍스트가 없습니다. 이미지 기반 PDF는 OCR 연동이 필요할 수 있습니다.");
    const success = parsed.success !== false && Boolean(markdown.trim());
    return sendJson(response, success ? 200 : 422, { success, extractionStatus: success ? "available" : "failed", parser: "kordoc", markdown, extractedText: markdown, json: parsed, warnings });
  } catch (error) {
    const unavailable = error.code === "ENOENT";
    const statusCode = error.statusCode || (unavailable ? 503 : 502);
    diagnosticLog("parser.request.error", { requestId, status: statusCode, error: diagnosticError(error) });
    return sendJson(response, statusCode, {
      success: false,
      errorCategory: "parser",
      extractionStatus: unavailable ? "unavailable" : "failed",
      parser: "kordoc",
      requestId,
      warnings: [unavailable ? "서버에서 Kordoc 실행 파일을 찾지 못했습니다." : String(error.message || "문서 파싱에 실패했습니다.").slice(0, 500)]
    });
  } finally {
    if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function serveStatic(request, response) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch (_) { response.writeHead(400).end("Bad request"); return; }
  const filename = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  if (!PUBLIC_FILES.has(filename)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  try {
    let content = await fs.readFile(path.join(ROOT, filename));
    if (filename === "index.html") {
      content = Buffer.from(content.toString("utf8").replace(
        '<meta name="rnd-next-ntis-configured" content="false">',
        `<meta name="rnd-next-ntis-configured" content="${Boolean(process.env.NTIS_API_KEY)}">`
      ));
    }
    response.writeHead(200, { "Content-Type": CONTENT_TYPES[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-cache" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (_) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/reports/hwpx") return handleHwpxReport(request, response);
  if (request.method === "POST" && request.url === "/api/documents/parse") return handleDocumentParse(request, response);
  if (request.method === "POST" && request.url === "/api/ntis/achievements") return handleNtisAchievements(request, response);
  if (request.method === "POST" && request.url === "/api/agents/run") return handleAgentRun(request, response);
  if ((request.method === "GET" || request.method === "HEAD") && request.url === "/api/health") {
    return sendJson(response, 200, { ok: true, adapterVersion: "ntis-2026-09-21-seoul-proxy-2", documentParser: "kordoc", agentRunner: true, openaiModel: OPENAI_MODEL, ntisConfigured: Boolean(process.env.NTIS_API_KEY) });
  }
  if (request.method === "GET" || request.method === "HEAD") return serveStatic(request, response);
  response.writeHead(405, { Allow: "GET, HEAD, POST", "Content-Type": "text/plain; charset=utf-8" }).end("Method not allowed");
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`R&D NEXT pilot: http://localhost:${PORT}`);
    console.log("Document parsing: POST /api/documents/parse (PDF/HWP/HWPX via kordoc)");
    console.log("NTIS achievement evidence: POST /api/ntis/achievements");
    console.log(`OpenAI agent runner: POST /api/agents/run (${OPENAI_MODEL})`);
  });
}

module.exports = { server, compactPriorResults, promptFor, outputSchemaFor, normalizeAgentResult, reconcileFinalResult, ensureUniqueDiagnosisScores };
