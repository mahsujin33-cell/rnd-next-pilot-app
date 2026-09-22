"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const JSZip = require("jszip");

const TEMPLATE_PATH = path.join(__dirname, "report-template.hwpx");
const FIELD_NAMES = ["분석개요", "technology", "industry", "policy", "challenger", "transition", "next_synthesizer"];

async function normalizeClickHereNames(input, projectName = "") {
  const zip = await JSZip.loadAsync(input);
  const sectionNames = Object.keys(zip.files).filter((name) => /^Contents\/section\d+\.xml$/i.test(name));
  for (const name of sectionNames) {
    let xml = await zip.file(name).async("string");
    xml = xml.replace(/(<hp:fieldBegin\b[^>]*\bname=")"([^>]*>[\s\S]*?<hp:fieldEnd\b)/g, (match, prefix, rest) => {
      const label = /<hp:t>([^<]*)<\/hp:t>/.exec(rest)?.[1]?.trim();
      if (!label || !/^[A-Za-z0-9가-힣_-]+$/.test(label)) return match;
      return `${prefix}${label}"${rest}`;
    });
    if (name.toLowerCase() === "contents/section1.xml") {
      const paragraphs = [];
      const paragraphRe = /<hp:p\b[\s\S]*?<\/hp:p>/g;
      let cursor = 0;
      let match;
      while ((match = paragraphRe.exec(xml))) {
        paragraphs.push({ before: xml.slice(cursor, match.index), xml: match[0], text: match[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
        cursor = match.index + match[0].length;
      }
      if (paragraphs.length) {
        const boundaries = [
          "분석개요", "technology", "industry", "policy", "challenger", "transition", "next_synthesizer"
        ];
        const headingRe = /^(?:[가-아]\.\s*(?:분석대상|NTIS|분석 입력|첨부자료|Technology Agent|Industry Agent|Policy Agent|Challenger Agent|Transition Agent|NEXT Synthesizer)|[1-5]\.\s*Agent|[1-5]\.\s*분석)/;
        const fieldIndexes = boundaries.map((label) => paragraphs.findIndex((p) => p.xml.includes('type="CLICK_HERE"') && p.text.includes(label)));
        for (let n = 0; n < boundaries.length; n++) {
          const fieldIndex = fieldIndexes[n];
          if (fieldIndex < 0) continue;
          paragraphs[fieldIndex].xml = paragraphs[fieldIndex].xml.replace(/charPrIDRef="\d+"/, 'charPrIDRef="8"');
          const end = fieldIndexes[n + 1] >= 0 ? fieldIndexes[n + 1] : paragraphs.length;
          for (let i = fieldIndex + 1; i < end; i++) {
            if (!headingRe.test(paragraphs[i].text)) paragraphs[i].xml = "";
          }
        }
        xml = paragraphs.map((p) => p.before + p.xml).join("") + xml.slice(cursor);
      }
    }
    const safeProjectName = String(projectName || "과제명 미입력").replace(/[<&>]/g, (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[value])).trim() || "과제명 미입력";
    xml = xml.replace(/<hp:t>- 과제명 -<\/hp:t>/g, `<hp:t>${safeProjectName}</hp:t>`);
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

function sectionBody(markdown, startPattern, endPatterns) {
  const start = markdown.search(startPattern);
  if (start < 0) return "추가 판단 필요";
  let end = markdown.length;
  for (const pattern of endPatterns) {
    const match = pattern.exec(markdown.slice(start + 1));
    if (match) end = Math.min(end, start + 1 + match.index);
  }
  const value = markdown.slice(start, end)
    .replace(/^#{1,6}\s+[^\n]+\n*/m, "")
    .replace(/^---\s*$/gm, "")
    .trim();
  return value || "추가 판단 필요";
}

function buildFieldValues(markdown) {
  const md = String(markdown || "");
  return {
    분석개요: sectionBody(md, /^1\. 분석 개요\b/m, [/^2\. Agent 진단 결과\b/m]),
    technology: sectionBody(md, /^## .*Technology Agent\b/m, [/^## .*Industry Agent\b/m]),
    industry: sectionBody(md, /^## .*Industry Agent\b/m, [/^## .*Policy Agent\b/m]),
    policy: sectionBody(md, /^## .*Policy Agent\b/m, [/^3\. Agent 검증\b/m]),
    challenger: sectionBody(md, /^## .*Challenger Agent\b/m, [/^4\. Agent 종합\s*분석\b/m, /^4\. Agent 종합\s*분석\b/m]),
    transition: sectionBody(md, /^## .*Transition Agent\b/m, [/^5\. NEXT 전환경로 설계\b/m]),
    next_synthesizer: sectionBody(md, /^## .*NEXT Synthesizer\b/m, [])
  };
}

async function buildTemplateReport(markdown, projectName = "") {
  const kordoc = await import("kordoc");
  const original = await fs.readFile(TEMPLATE_PATH);
  const normalized = await normalizeClickHereNames(original, projectName);
  const values = buildFieldValues(markdown);

  const filled = await kordoc.fillHwpx(normalized, values);
  const unmatched = Array.isArray(filled.unmatched) ? filled.unmatched : [];
  const applied = Array.isArray(filled.filled) ? filled.filled : [];
  const mapping = { template: path.basename(TEMPLATE_PATH), fields: FIELD_NAMES, applied, unmatched };
  if (unmatched.length || applied.length !== FIELD_NAMES.length || !filled.buffer) {
    const error = new Error("HWPX 누름틀 매핑이 완료되지 않았습니다.");
    error.code = "HWPX_TEMPLATE_MAPPING_INCOMPLETE";
    error.mapping = mapping;
    throw error;
  }
  const data = Buffer.from(filled.buffer);
  const validation = await kordoc.validateHwpx(data);
  if (!validation.ok) {
    const error = new Error("누름틀 매핑 결과의 HWPX 구조 검증에 실패했습니다.");
    error.code = "HWPX_TEMPLATE_VALIDATION_FAILED";
    error.mapping = { ...mapping, validation };
    throw error;
  }
  const reparsed = await kordoc.parse(data, { format: "hwpx", keepEmptyParagraphs: true });
  if (!reparsed?.success) {
    const error = new Error("누름틀 매핑 결과를 재파싱하지 못했습니다.");
    error.code = "HWPX_TEMPLATE_REPARSE_FAILED";
    error.mapping = { ...mapping, validation };
    throw error;
  }
  return { data, mapping: { ...mapping, validation, reparsedBlocks: reparsed.blocks?.length || 0, reparsedPages: reparsed.pages?.length || 0 } };
}

module.exports = { TEMPLATE_PATH, buildTemplateReport, buildFieldValues, normalizeClickHereNames };
