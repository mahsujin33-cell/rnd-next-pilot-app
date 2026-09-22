"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const model = require("./project-model.js");
const serverSource = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

assert.match(serverSource, /\{ type: "json_schema", json_schema:/);
assert.match(serverSource, /\{ type: "json_object" \}/);
for (const field of ["conclusion", "keyFindings", "evidence", "uncertainties", "bottlenecks", "nextCandidates", "dataRequests", "confidenceRationale", "critiques", "crossAgentConflicts", "overallAssessment", "reversalConditions", "routeCandidates", "recommendedRoute", "primaryNext", "bottleneckEvidence", "decision", "executionPlan", "rejectedAlternatives", "reassessmentTriggers"]) {
  assert.ok(serverSource.includes(field), `server output contract is missing ${field}`);
}

const documentStub = {
  querySelector: () => null,
  addEventListener: () => {}
};
const context = {
  window: { RndNextProjectModel: model },
  document: documentStub,
  localStorage: { getItem: () => null, setItem: () => {} },
  location: { hash: "" },
  setTimeout, clearTimeout, console, Intl, Date, JSON, Number, String, Boolean,
  FormData: function () {}, FileReader: function () {}, fetch: async () => { throw new Error("not called"); }
};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "app.js"), "utf8"), context, { filename: "app.js" });

const manual = { name: "사용자가 입력한 양자센서 과제", organization: "수동입력 연구원", field: "정보보안" };
const candidate = { id: "NTIS-REF-99", title: "서로 다른 AI 반도체 후보", org: "참고기관", period: "2021–2024", similarity: 87 };
const project = context.window.RndNextTest.AnalysisEngine.createProject(manual, candidate, null);

assert.equal(project.name, manual.name);
assert.equal(project.organization, manual.organization);
assert.equal(project.field, manual.field);
assert.deepEqual(JSON.parse(JSON.stringify(project.analysisInput.targetProject)), { id: "", ...manual });
assert.equal(project.ntisReference.title, candidate.title);
assert.equal(project.analysisInput.sources.ntisReference.title, candidate.title);
assert.notEqual(project.name, candidate.title);
for (const domain of ["technology", "industry", "policy"]) {
  const result = project.agentResults[domain];
  assert.equal(typeof result.conclusion, "string");
  assert.ok(result.keyFindings.length >= 3 && result.keyFindings.length <= 6);
  assert.ok(result.evidence.length >= 3 && result.evidence.length <= 6);
  assert.ok(result.uncertainties.length >= 3 && result.uncertainties.length <= 5);
  assert.ok(result.bottlenecks.length >= 2 && result.bottlenecks.length <= 4);
  assert.ok(result.nextCandidates.length >= 2 && result.nextCandidates.length <= 4);
  assert.ok(result.dataRequests.length >= 2 && result.dataRequests.length <= 5);
  assert.match(result.conclusion, /^\[DEMO\]/);
  assert.equal(typeof result.confidenceRationale, "string");
}
for (const domain of ["technology", "industry", "policy"]) {
  const critique = project.agentResults.challenger.critiques[domain];
  assert.ok(critique.counterArguments.length >= 2);
  assert.ok(critique.weakEvidence.length >= 2);
  assert.ok(critique.verificationQuestions.length >= 2);
  assert.ok(critique.reversalConditions.length >= 1);
}
assert.ok(project.agentResults.challenger.crossAgentConflicts.length >= 1);
assert.ok(project.agentResults.transition.routeCandidates.length >= 2 && project.agentResults.transition.routeCandidates.length <= 3);
for (const route of project.agentResults.transition.routeCandidates) {
  for (const field of ["route", "rationale", "preconditions", "bottleneck", "actions", "evidence", "missingData"]) assert.ok(route[field], `transition route is missing ${field}`);
}
const final = project.agentResults.final;
assert.equal(final.primaryNext, "실증");
assert.match(final.bottleneck, /데이터 접근권/);
assert.ok(final.executionPlan.length >= 3);
assert.ok(final.rejectedAlternatives.length >= 1);
assert.ok(final.reassessmentTriggers.length >= 1);

const achievements = [{ collection: "rpaper", type: "paper", id: "PAPER-1", title: "참고 논문", projectId: "PJT-1" }];
const directProject = context.window.RndNextTest.AnalysisEngine.createProject(
  { ...manual, id: "MANUAL-PJT-7" }, null, null, false, false,
  { results: achievements, counts: { rpaper: 1, rpatent: 0, rresearch: 0 }, warnings: [], source: { provider: "NTIS", status: "available" } }
);
assert.equal(directProject.ntisReference, undefined);
assert.equal(directProject.projectId, "MANUAL-PJT-7");
assert.equal(directProject.analysisInput.targetProject.name, manual.name);
assert.equal(directProject.analysisInput.sources.ntisAchievements[0].title, "참고 논문");
assert.equal(directProject.analysisInput.sources.ntisAchievements[0].title === directProject.name, false);

const legacy = model.migrateProject({ name: "기존 대상", organization: "기존 기관", field: "AI", ntisId: "OLD-NTIS-1", analysisInput: { project: { name: "기존 대상" } } });
assert.equal(legacy.analysisInput.targetProject.name, "기존 대상");
assert.equal(legacy.analysisInput.sources.ntisReference.id, "OLD-NTIS-1");

console.log("PASS: direct flow accepts null candidate, preserves manual target, and keeps NTIS achievements as reference evidence.");
