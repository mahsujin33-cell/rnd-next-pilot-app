"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const { server, compactPriorResults, promptFor, outputSchemaFor } = require("./server.js");

function verifyStrictSchema(schema) {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false, "strict object schemas must disallow extra properties");
    assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)), "every strict object property must be required");
    Object.values(schema.properties).forEach(verifyStrictSchema);
  }
  if (schema.type === "array") verifyStrictSchema(schema.items);
}

for (const agent of ["technology", "industry", "policy", "challenger", "transition", "final"]) verifyStrictSchema(outputSchemaFor(agent));

const oversized = "가".repeat(5000);
const prior = {
  technology: { score: 80, summary: oversized, strengths: Array(20).fill(oversized), risks: [oversized], insight: oversized, evidence: Array(20).fill({ claim: oversized, source: oversized }) },
  industry: { score: 70, summary: oversized }, policy: { score: 60, summary: oversized },
  challenger: { score: 50, summary: oversized, critiques: {}, crossAgentConflicts: Array(20).fill(oversized) },
  transition: { score: 65, summary: oversized }, final: { score: 75, summary: oversized }
};
const finalPrior = compactPriorResults(prior, "final");
assert.deepEqual(Object.keys(finalPrior), ["technology", "industry", "policy", "challenger", "transition"]);
assert.ok(JSON.stringify(finalPrior).length < 18000, "later-agent prior results must stay tightly bounded");
const prompt = promptFor("transition", { analysisInput: { targetProject: { name: oversized }, sources: { ntisReference: null, ntisAchievements: [] }, reportContent: { content: oversized.repeat(20), warnings: [] } } }, prior);
assert.ok(prompt.length <= 42000, "prompt must be capped");

function domainResult(label) {
  return {
    score: 70, summary: `${label} 요약`, strengths: ["강점"], risks: ["위험"], insight: "제안",
    conclusion: "판정", keyFindings: ["1", "2", "3"],
    evidence: [1, 2, 3].map((n) => ({ claim: `근거${n}`, source: "수동 입력 대상", sourceType: "manual", pageOrId: "확인 불가", certainty: "낮음" })),
    uncertainties: ["1", "2", "3"], bottlenecks: ["1", "2"], nextCandidates: ["1", "2"], dataRequests: ["1", "2"], confidenceRationale: "근거 부족"
  };
}

function post(port, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = http.request({ hostname: "127.0.0.1", port, path: "/api/agents/run", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const originalFetch = global.fetch;
  try {
    const noKey = await post(port, { agents: ["technology"], analysisInput: {} });
    assert.equal(noKey.status, 400);
    assert.equal(noKey.body.success, false);
    assert.equal(noKey.body.error.phase, "요청 검증");

    const formats = [];
    global.fetch = async (_url, options) => {
      const requestBody = JSON.parse(options.body);
      formats.push(requestBody.response_format.type);
      if (formats.length === 1) return new Response('{"error":"schema details must never escape"}', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(domainResult("기술")) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const fallback = await post(port, { apiKey: "sk-deliberately-invalid-placeholder-123456", agents: ["technology"], analysisInput: { analysisTarget: { name: "테스트" } } });
    assert.equal(fallback.status, 200);
    assert.deepEqual(formats, ["json_schema", "json_object"]);

    global.fetch = async (_url, options) => {
      const name = JSON.parse(options.body).response_format.json_schema.name;
      if (name.startsWith("industry")) return new Response("provider raw secret", { status: 502 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(domainResult(name)) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const partial = await post(port, { apiKey: "sk-secret-must-not-appear-123456", agents: ["technology", "industry", "policy"], analysisInput: { analysisTarget: { name: "테스트" } } });
    assert.equal(partial.status, 502);
    assert.equal(partial.body.partial, true);
    assert.deepEqual(partial.body.completedAgents.sort(), ["policy", "technology"]);
    assert.equal(partial.body.error.failedAgent, "industry");
    assert.equal(partial.body.error.phase, "Industry");
    assert.doesNotMatch(JSON.stringify(partial.body), /provider raw|sk-secret/);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("PASS: compact prompts, strict-schema fallback, safe errors, and partial results are resilient.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
