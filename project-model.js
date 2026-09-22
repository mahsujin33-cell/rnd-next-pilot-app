(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RndNextProjectModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function text(value) { return typeof value === "string" ? value : ""; }

  function normalizeAchievements(items) {
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((item) => ({ ...item }));
  }

  function buildAnalysisInput(form, candidate, reportContent, ntisAchievements, ntisSource) {
    return {
      targetProject: {
        id: text(form.id || form.projectId),
        name: text(form.name),
        organization: text(form.organization),
        field: text(form.field)
      },
      sources: {
        ntisReference: candidate ? {
          id: text(candidate.id),
          title: text(candidate.title),
          org: text(candidate.org),
          period: text(candidate.period),
          similarity: Number.isFinite(candidate.similarity) ? candidate.similarity : null
        } : null,
        ntisAchievements: normalizeAchievements(ntisAchievements),
        ntisSource: ntisSource && typeof ntisSource === "object" ? { ...ntisSource } : null
      },
      reportContent: reportContent || null
    };
  }

  function migrateProject(project) {
    const target = project.analysisInput?.targetProject || {
      id: text(project.projectId),
      name: text(project.name),
      organization: text(project.organization),
      field: text(project.field)
    };
    project.name = text(target.name || project.name);
    project.organization = text(target.organization || project.organization);
    project.field = text(target.field || project.field);
    project.projectId = text(target.id || project.projectId);

    const priorReference = project.ntisReference || project.analysisInput?.sources?.ntisReference;
    if (priorReference || project.ntisId) {
      const sourceReference = priorReference || {};
      project.ntisReference = {
        id: text(sourceReference.id || project.ntisId),
        title: text(sourceReference.title),
        org: text(sourceReference.org),
        period: text(sourceReference.period),
        similarity: Number.isFinite(sourceReference.similarity) ? sourceReference.similarity : null
      };
    } else delete project.ntisReference;
    const achievements = normalizeAchievements(project.ntisAchievements || project.analysisInput?.sources?.ntisAchievements);
    const source = project.ntisSource || project.analysisInput?.sources?.ntisSource || null;
    project.ntisAchievements = achievements;
    project.ntisSource = source && typeof source === "object" ? { ...source } : null;

    const legacyReport = project.analysisInput?.report || null;
    project.analysisInput = buildAnalysisInput(
      { id: project.projectId, name: project.name, organization: project.organization, field: project.field },
      project.ntisReference,
      project.analysisInput?.reportContent || legacyReport,
      achievements,
      project.ntisSource
    );
    if (project.ntisReference?.id) project.ntisId = project.ntisReference.id;
    return project;
  }

  return { buildAnalysisInput, migrateProject, normalizeAchievements };
});
