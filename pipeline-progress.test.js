"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const { server } = require("./server.js");

function resultFor(agent) {
  return { score: 70, summary: `${agent} 요약`, strengths: ["강점"], risks: ["위험"], insight: "구체 제안" };
}

function postStream(port, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = http.request({ hostname: "127.0.0.1", port, path: "/api/agents/run", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, type: response.headers["content-type"], text: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const originalFetch = global.fetch;
  const calls = [];
  const firstDone = new Set();
  try {
    global.fetch = async (_url, options) => {
      const request = JSON.parse(options.body);
      const agent = request.response_format.json_schema.name.replace(/_analysis$/, "");
      calls.push(agent);
      if (["technology", "industry", "policy"].includes(agent)) {
        await new Promise((resolve) => setTimeout(resolve, { technology: 20, industry: 5, policy: 12 }[agent]));
        firstDone.add(agent);
      } else if (agent === "challenger") {
        assert.equal(firstDone.size, 3, "Challenger must not start before all first-wave agents succeed");
      } else if (agent === "transition") {
        assert.equal(calls.at(-2), "challenger", "Transition must start only after Challenger");
      } else if (agent === "final") {
        assert.equal(calls.at(-2), "transition", "NEXT Synthesizer must start only after Transition");
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(resultFor(agent)) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const response = await postStream(port, { apiKey: "sk-deliberately-invalid-placeholder-123456", stream: true, agents: ["technology", "industry", "policy", "challenger", "transition", "final"], analysisInput: { analysisTarget: { name: "순차 실행 테스트" } } });
    assert.equal(response.status, 200);
    assert.match(response.type, /application\/x-ndjson/);
    const events = response.text.trim().split("\n").map(JSON.parse);
    const runningPhases = events.filter((event) => event.type === "phase" && event.status === "running").map((event) => event.phase);
    assert.deepEqual(runningPhases, ["diagnosis", "challenger", "transition", "final"]);
    assert.equal(events.at(-1).type, "complete");
    assert.deepEqual(calls.slice(0, 3), ["technology", "industry", "policy"]);
    assert.deepEqual(calls.slice(3), ["challenger", "transition", "final"]);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("PASS: streamed phase progress exposes the strictly sequential real pipeline.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
