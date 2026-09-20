"use strict";

const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const fsSync = require("node:fs");

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
const OPENAI_TIMEOUT_MS = 45000;
const OPENAI_PHASE_TIMEOUT_MS = Object.freeze({ challenger: 55000, transition: 65000, final: 65000 });
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_MAX_TOKENS = 3600;
const MAX_PROMPT_CHARS = 42000;
const NTIS_ENDPOINT = "https://www.ntis.go.kr/rndopen/openApi/natRnDAllSearch";
const NTIS_TIMEOUT_MS = 10000;
const MAX_NTIS_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_NTIS_RESULTS_PER_COLLECTION = 10;
const NTIS_COLLECTIONS = Object.freeze({ rpaper: "PAP", rpatent: "PAT", rresearch: "TRKO" });
const MAX_PARSER_OUTPUT_BYTES = 12 * 1024 * 1024;
const PARSER_TIMEOUT_MS = 120000;
const PARSABLE_EXTENSIONS = new Set(["pdf", "hwp", "hwpx"]);
const PUBLIC_FILES = new Set(["index.html", "project-model.js", "app.js", "styles.css", "preview.html"]);
const CONTENT_TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

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
    ? ["PAPER_NM", "PAPERNAME", "TITLE", "KOR_TITLE"]
    : collection === "rpatent"
      ? ["IPR_INVENTION_NM", "INVENTIONNAME", "PATENT_NM", "TITLE"]
      : ["KOR_RPT_TITLE_NM", "REPORTTITLE", "RPT_NM", "TITLE"];
  const item = {
    collection,
    type: collection === "rpaper" ? "paper" : collection === "rpatent" ? "patent" : "researchReport",
    id: firstXmlValue(values, ["RST_ID", "RESULT_ID", "ID", "PAPER_ID", "PATENT_ID", "RPT_ID"]),
    title: firstXmlValue(values, titleFields),
    projectId: firstXmlValue(values, ["PJT_ID", "PROJECTNUMBER", "PROJECT_ID", "PJT_NO"]),
    projectName: firstXmlValue(values, ["KOR_PJT_NM", "PROJECTTITLE", "PJT_NM", "PROJECT_NAME"]),
    organization: firstXmlValue(values, ["ORG_NM", "ORGANIZATION", "RESEARCHAGENCY", "AUTHOR_AFFILIATION", "PUBLISHER_NM", "APPLICANT_NM"]),
    year: firstXmlValue(values, ["PERFORMANCE_YEAR", "PUB_YEAR", "PUBLICATION_YEAR", "ISSUE_YEAR", "YEAR", "RPT_YEAR", "APPL_YEAR"]),
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

async function fetchNtisCollection(collection, dbt, searchWord, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NTIS_TIMEOUT_MS);
  const url = new URL(NTIS_ENDPOINT);
  url.search = new URLSearchParams({
    apprvKey: apiKey, userId: "", collection, SRWR: searchWord, searchFd: "BI",
    addQuery: `DBT=${dbt}`, startPosition: "1", displayCnt: String(MAX_NTIS_RESULTS_PER_COLLECTION)
  }).toString();
  try {
    const response = await fetch(url, { headers: { Accept: "application/xml,text/xml;q=0.9" }, signal: controller.signal });
    const xml = await readCappedResponse(response, MAX_NTIS_RESPONSE_BYTES);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseNtisXml(collection, xml);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("요청 시간 초과");
    if (/^(?:HTTP \d+|NTIS)/.test(String(error.message || ""))) throw error;
    throw new Error("NTIS 연결 오류");
  } finally { clearTimeout(timer); }
}

async function handleNtisAchievements(request, response) {
  let body = {};
  try { body = await readJsonBody(request, 32 * 1024); }
  catch (error) { return sendJson(response, error.statusCode || 400, { success: false, results: [], counts: {}, warnings: [error.message], source: { provider: "NTIS", endpoint: "natRnDAllSearch", status: "invalid-request" } }); }
  const project = body?.project && typeof body.project === "object" && !Array.isArray(body.project) ? body.project : body;
  const name = cleanString(project?.name, 200).trim();
  const organization = cleanString(project?.organization, 160).trim();
  const projectId = cleanString(project?.id || project?.projectId || project?.ntisId, 100).trim();
  const searchWord = [name, organization, projectId].filter(Boolean).join(" ");
  const queriedAt = new Date().toISOString();
  const emptyCounts = Object.fromEntries(Object.keys(NTIS_COLLECTIONS).map((key) => [key, 0]));
  if (!process.env.NTIS_API_KEY) {
    return sendJson(response, 200, { success: true, results: [], counts: emptyCounts, warnings: ["NTIS_API_KEY가 설정되지 않아 성과 근거 없이 분석을 계속합니다."], source: { provider: "NTIS", endpoint: "natRnDAllSearch", status: "not-configured", queriedAt, query: searchWord } });
  }
  if (!name) {
    return sendJson(response, 200, { success: true, results: [], counts: emptyCounts, warnings: ["과제명이 없어 NTIS 성과 조회를 건너뛰었습니다."], source: { provider: "NTIS", endpoint: "natRnDAllSearch", status: "skipped", queriedAt, query: searchWord } });
  }
  const entries = Object.entries(NTIS_COLLECTIONS);
  const settled = await Promise.allSettled(entries.map(async ([collection, dbt]) => [collection, await fetchNtisCollection(collection, dbt, searchWord, process.env.NTIS_API_KEY)]));
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
  return sendJson(response, 200, { success: true, results, counts, warnings, source: { provider: "NTIS", endpoint: "natRnDAllSearch", status, queriedAt, query: searchWord, collections: Object.keys(NTIS_COLLECTIONS) } });
}

const AGENT_ORDER = ["technology", "industry", "policy", "challenger", "transition", "final"];
const AGENT_DEFINITIONS = {
  technology: { name: "Technology", subtitle: "기술 경쟁력 분석", role: "현재 기술성숙도와 기술적 후속 필요성을 판단한다.", criteria: "TRL, 핵심기술 확보, 목표 대비 성능, 미해결 병목, 경쟁·대체기술, 통합·확장성, 실험실과 실제환경의 격차", boundary: "시장성이나 정책 필요성을 최종 판단하지 않는다.", required: "기술적 NEXT, 근거, 불확실성" },
  industry: { name: "Industry", subtitle: "시장·산업 분석", role: "민간 시장과 산업 수요 관점에서 후속 지원 필요성을 판단한다.", criteria: "시장 형성, 실제 수요기업, 민간투자, 상용제품, 경쟁, 채택 속도, 지불의사, 공급망, 진입장벽, 해외의존도, 국내 경쟁력, 민간 자체개발 가능성", boundary: "시장성숙도·민간투자·수요기업 존재를 입력 근거 없이 확정하지 않는다.", required: "산업적 NEXT, 근거, 불확실성" },
  policy: { name: "Policy", subtitle: "정책 부합성 분석", role: "국가정책, 정부 역할, 공공 필요성 측면의 추가 정부 R&D 개입 필요성을 판단한다.", criteria: "국가전략 부합성, 정부개입·시장실패, 전략기술, 공공성, 기존 지원 중복, 정책환경 변화", boundary: "기술성숙도나 시장규모를 독자 확정하지 않고, 전략 포함만으로 지원 필요를 결론내리거나 후속 R&D를 단독 결정하지 않는다.", required: "정책적 NEXT, 정부개입 필요성, 정책 근거, 기존 사업 관계, 불확실성" },
  challenger: { name: "Challenger", subtitle: "반론·취약점 검증", role: "앞선 세 진단의 논리적 비약, 근거 부족, 상충 주장과 확증편향을 검증한다.", criteria: "주장-근거 연결, Agent 간 불일치, 최신성·신뢰성, 반대근거, 인과와 상관 혼동, 정부지원 논리 비약, 낙관·비관 편향", boundary: "새 결론을 임의로 만들거나 반대를 위한 반대를 하지 않고 최종 NEXT를 단독 결정하지 않는다.", required: "핵심 반론, 충돌지점, 약한 주장, 검증 질문, 판단이 뒤집힐 조건" },
  transition: { name: "Transition", subtitle: "전환 경로 설계", role: "진단과 검증을 바탕으로 현실적인 후속 전환 후보 2~3개와 선결조건·병목을 설계한다.", criteria: "TRL 적합성, 실제 수요, 민간투자, 실증, 표준·인증, 기술이전, 후속 R&D, 정책수단 적합성, 핵심 병목", boundary: "사업 실행이나 특정 기업 이전을 결정하지 않고 새 사실을 만들거나 한 경로를 강제하지 않는다. 근거 부족은 '추가 판단 필요'로 쓴다.", required: "후보 경로 2~3개, 경로별 선결조건, 병목, 추가 정보" },
  final: { name: "NEXT Synthesizer", subtitle: "통합 판단 및 권고", role: "후보 중 주요 NEXT 하나와 대안 1~2개, 이유, 신뢰도와 다음 행동을 제시한다.", criteria: "병목 해결 적합성, 선행조건, 전환 준비도, 판단 일관성, Challenger 결과, 근거 신뢰도, 경로 간 순차·병행 관계", boundary: "근거를 만들거나 점수만으로 선정하지 않고, 반론·미충족 조건을 무시하거나 근거 부족 상태에서 결정을 강제하지 않는다.", required: "주요 NEXT, 대안, 선정·제외 이유, 신뢰도, 다음 행동" }
};

function cleanString(value, maxLength) {
  return typeof value === "string" ? value.replace(/\0/g, "").slice(0, maxLength) : "";
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
      claim: cleanString(item?.claim, stringLimit), source: cleanString(item?.source, 120),
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
  const domainContract = "Technology/Industry/Policy는 conclusion(판정), keyFindings 3~6개, evidence 3~6개, uncertainties 3~5개, bottlenecks 2~4개, nextCandidates 2~4개, dataRequests 2~5개, confidenceRationale을 구체적으로 작성한다. evidence의 claim은 입력에서 직접 뒷받침되는 주장만 쓰고 source는 '수동 입력 대상', '종료보고서', 'NTIS 성과 근거' 중 실제 근거 종류를 명시하며 sourceType과 pageOrId를 채운다. 페이지·식별자가 없으면 '확인 불가'라고 쓴다.";
  const challengerContract = "Challenger는 critiques.technology, critiques.industry, critiques.policy를 모두 작성한다. 각 도메인에 verdict, counterArguments 2~4개, weakEvidence 2~4개, verificationQuestions 2~4개, reversalConditions 1~3개를 제공하고, crossAgentConflicts, overallAssessment, confidenceRationale을 작성한다.";
  const transitionContract = "Transition은 routeCandidates에 서로 구별되는 후보 경로 2~3개를 작성한다. 각 후보는 route, rationale, preconditions, bottleneck, actions, evidence, missingData를 모두 포함한다. recommendedRoute는 후보 route 중 하나이거나 근거가 부족하면 '추가 판단 필요'다. 병목과 행동은 추상어 대신 대상 과제에서 실제로 확인·검증할 항목을 명시한다.";
  const finalContract = "NEXT Synthesizer는 primaryNext를 허용된 6개 경로 중 하나로 선택하고, bottleneck에 구체적인 단일 핵심 병목, bottleneckEvidence에 그 판단 근거, decision에 해당 경로를 택한 이유를 쓴다. preconditions 2~5개, executionPlan 3~6개(각 action, owner, time, KPI), rejectedAlternatives 1~4개(route, reason), confidence 0~100, confidenceRationale, reassessmentTriggers 1~4개를 모두 작성한다. 입력 근거가 owner/time/KPI를 뒷받침하지 않으면 해당 값은 반드시 '확인 필요'로 쓴다. '병목 해결이 필요합니다'처럼 병목명과 경로가 없는 일반론은 금지한다.";
  const contract = ["technology", "industry", "policy"].includes(agentKey) ? domainContract : agentKey === "challenger" ? challengerContract : agentKey === "transition" ? transitionContract : finalContract;
  const prompt = [`당신은 R&D NEXT의 ${definition.name} Agent다.`, `역할: ${definition.role}`, `판단 기준: ${definition.criteria}`, `금지/경계: ${definition.boundary}`, `필수 관점: ${definition.required}`, "[최우선 대상 규칙] analysisTarget만 분석 대상이다. 모든 진단, 점수, 요약, NEXT 제안의 주어는 analysisTarget이어야 한다.", "referenceSources.ntisReference와 referenceSources.ntisAchievements는 참고·보강용 증거일 뿐 분석 대상이 아니다. NTIS 성과의 제목·기관·내용을 대상 정보에 대입하거나 분석 대상을 NTIS 항목으로 바꾸지 않는다.", "reportContent는 analysisTarget에 사용자가 첨부한 별도 종료보고서 근거다. NTIS 근거와 혼동하지 않는다.", "아래 제공 입력만 증거로 사용한다. 외부 사실, 수치, 출처, 기업, 정책, 페이지 번호를 지어내지 않는다.", "확인할 수 없는 사실은 추론으로 메우지 말고 해당 필드에 '확인 불가' 또는 '추가 판단 필요'를 명시한다. 정보가 부족해도 배열 개수는 지키되, 무엇이 왜 미확인인지 서로 다른 항목으로 쓴다.", "score는 증거 충실도와 준비도를 종합한 0~100 정수이며, 근거가 빈약하면 보수적으로 부여한다.", "summary, strengths, risks, insight는 기존 클라이언트 호환을 위해 반드시 함께 출력한다.", contract, "한국어로만 답하고 JSON Schema에 맞는 JSON 객체만 출력한다.", `명시적으로 구분된 증거 입력:\n${JSON.stringify(evidence)}`].join("\n");
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
  properties: { claim: stringSchema, source: stringSchema, sourceType: stringSchema, pageOrId: stringSchema, certainty: { type: "string", enum: ["높음", "중간", "낮음", "확인 불가"] } },
  required: ["claim", "source", "sourceType", "pageOrId", "certainty"]
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

async function openAIRequest(apiKey, agentKey, input, priorResults, useStrictSchema) {
  const timeoutMs = OPENAI_PHASE_TIMEOUT_MS[agentKey] || OPENAI_TIMEOUT_MS;
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
      const error = new Error(safeProviderMessage(response.status));
      error.providerStatus = response.status;
      error.statusCode = response.status === 401 ? 401 : response.status === 429 ? 429 : 502;
      error.code = `OPENAI_${response.status}`;
      throw error;
    }
    return response.json();
  } catch (error) {
    if (error.name === "AbortError") throw Object.assign(new Error(`${AGENT_DEFINITIONS[agentKey].name} 단계가 제한 시간(${Math.round(timeoutMs / 1000)}초)을 초과했습니다.`), { statusCode: 504, code: "OPENAI_TIMEOUT" });
    if (error.statusCode || error.providerStatus) throw error;
    throw Object.assign(new Error("OpenAI 서비스에 안전하게 연결하지 못했습니다."), { statusCode: 502, code: "OPENAI_CONNECTION_FAILED" });
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
    Object.assign(results, input.priorResults);
    if (stream) response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" });
    const firstWave = input.agents.filter((agent) => ["technology", "industry", "policy"].includes(agent));
    phase = firstWave.length ? "diagnosis" : input.agents[0] || "request";
    if (stream && firstWave.length) emit({ type: "phase", phase: "diagnosis", status: "running", runningAgents: firstWave, completedAgents: AGENT_ORDER.filter((agent) => results[agent]) });
    const firstResults = await Promise.allSettled(firstWave.map(async (agent) => {
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
    if (stream && firstWave.length) emit({ type: "phase", phase: "diagnosis", status: "completed", completedAgents: AGENT_ORDER.filter((agent) => results[agent]) });
    for (const agent of ["challenger", "transition", "final"]) if (input.agents.includes(agent)) {
      phase = agent;
      if (stream) emit({ type: "phase", phase: agent, status: "running", runningAgents: [agent], completedAgents: AGENT_ORDER.filter((key) => results[key]) });
      try {
        results[agent] = await callOpenAI(input.apiKey, agent, input, results);
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
    const payload = {
      success: false, model: OPENAI_MODEL, partial: Object.keys(results).length > 0, results,
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

function runKordoc(inputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "--package", "kordoc", "--package", "pdfjs-dist", "kordoc", inputPath, "--format", "json"], {
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
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const diagnostic = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        const error = new Error(diagnostic || `kordoc가 종료 코드 ${code}로 실패했습니다.`);
        error.code = "KORDOC_FAILED";
        finish(reject, error);
      } else finish(resolve, { output, diagnostic });
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
    const result = await runKordoc(inputPath);
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
    return sendJson(response, error.statusCode || (unavailable ? 503 : 422), {
      success: false,
      extractionStatus: unavailable ? "unavailable" : "failed",
      parser: "kordoc",
      warnings: [unavailable ? "서버에서 npx를 실행할 수 없어 kordoc 파서를 사용할 수 없습니다." : String(error.message || "문서 파싱에 실패했습니다.").slice(0, 500)]
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
  if (request.method === "POST" && request.url === "/api/documents/parse") return handleDocumentParse(request, response);
  if (request.method === "POST" && request.url === "/api/ntis/achievements") return handleNtisAchievements(request, response);
  if (request.method === "POST" && request.url === "/api/agents/run") return handleAgentRun(request, response);
  if ((request.method === "GET" || request.method === "HEAD") && request.url === "/api/health") {
    return sendJson(response, 200, { ok: true, documentParser: "kordoc", agentRunner: true, openaiModel: OPENAI_MODEL, ntisConfigured: Boolean(process.env.NTIS_API_KEY) });
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

module.exports = { server, compactPriorResults, promptFor, outputSchemaFor, normalizeAgentResult };
