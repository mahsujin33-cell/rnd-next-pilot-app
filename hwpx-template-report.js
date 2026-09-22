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
    // Hancom may split the cover label across runs or omit the leading hyphen.
    // Replace only the exact cover-label text, not ordinary table labels such as
    // 과제명(과제번호).
    const titleCharPr = safeProjectName.length > 18 ? ' charPrIDRef="39"' : "";
    xml = xml.replace(/(<hp:run)(\s+charPrIDRef="\d+")([^>]*>)(<hp:t>)[^<]*과제명\s*-<\/hp:t>/g,
      `$1${titleCharPr}$3$4${safeProjectName}</hp:t>`);
    if (name.toLowerCase() === "contents/section0.xml") {
      xml = xml.replace(/(<hp:t>[^<]*(?:분석 개요|Agent 진단 결과|Agent 검증|Agent 종합 분석|NEXT 전환경로 설계)[^<]*<hp:tab\b[^>]*>)\s*00(<\/hp:t>)/g, "$1$2");
    }
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

async function normalizeFieldLineBreaks(input) {
  const zip = await JSZip.loadAsync(input);
  const sectionNames = Object.keys(zip.files).filter((name) => /^Contents\/section\d+\.xml$/i.test(name));
  for (const name of sectionNames) {
    let xml = await zip.file(name).async("string");
    xml = xml.replace(/<hp:t>([^<]*(?:<hp:lineBreak\/>[^<]*)+)<\/hp:t>/g, (_, body) =>
      body.split("<hp:lineBreak/>").map((part, index, parts) => `${part ? `<hp:t>${part}</hp:t>` : ""}${index < parts.length - 1 ? "<hp:lineBreak/>" : ""}`).join("")
    );
    xml = xml.replace(/<hp:p\b([^>]*)>([\s\S]*?)<\/hp:p>/g, (whole, attrs, body) => {
      if (!body.includes("fieldBegin") || !body.includes("<hp:lineBreak/>") ) return whole;
      const tokens = [...body.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>|<hp:lineBreak\/>/g)];
      if (!tokens.length) return whole;
      const lines = [[]];
      for (const token of tokens) {
        if (token[0] === "<hp:lineBreak/>") lines.push([]);
        else lines[lines.length - 1].push(token[1]);
      }
      const lineSeg = body.match(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/)?.[0] || "";
      return lines.map((line) => `<hp:p${attrs}><hp:run charPrIDRef="8"><hp:t>${line.join("")}</hp:t></hp:run>${lineSeg}</hp:p>`).join("");
    });
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

function sectionBody(markdown, startPattern, endPatterns) {
  const startMatches = [...markdown.matchAll(new RegExp(startPattern.source, `${startPattern.flags.replace(/g/g, "")}g`))];
  const start = startMatches.length ? startMatches[startMatches.length - 1].index : -1;
  if (start < 0) return "추가 판단 필요";
  let end = markdown.length;
  for (const pattern of endPatterns) {
    const match = pattern.exec(markdown.slice(start + 1));
    if (match) end = Math.min(end, start + 1 + match.index);
  }
  const value = markdown.slice(start, end)
    .replace(/^(?:#{1,6}\s*)?[^\n]+\n*/m, "")
    .replace(/^---\s*$/gm, "")
    .trim();
  return toReportText(value || "추가 판단 필요");
}

function toReportText(value) {
  return String(value || "추가 판단 필요")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<img\b[^>]*>/gi, "[이미지 생략]")
    .replace(/<\/tr\s*>/gi, "\n")
    .replace(/<\/?t[dh]\b[^>]*>/gi, "\t")
    .replace(/<\/?(?:table|tbody|thead|tr)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*#{1,6}\s+(.+)$/gm, (_, title) => {
      const text = title.trim();
      if (/^(?:[1-5]\.\s|[가-힣]+ Agent\b|NEXT Synthesizer\b)/u.test(text)) return text;
      return `■ ${text}`;
    })
    .replace(/^\s*>\s*/gm, "※ ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "ㅇ ")
    .replace(/^\s*([가-힣])\.\s+(.+)$/gm, "■ $1. $2")
    .replace(/\n?\s*■\s+/g, "\n\n■ ")
    .replace(/^\s*---+\s*$/gm, "")
    .replace(/^\s*```[^\n]*$/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() || "추가 판단 필요";
}

function dedupeNumberedSections(markdown) {
  return String(markdown || "");
}

function buildFieldValues(markdown) {
  const md = dedupeNumberedSections(markdown);
  return {
    분석개요: sectionBody(md, /^(?:#+\s*)?1\. 분석 개요\s*$/m, [/^(?:#+\s*)?2\. Agent 진단 결과\s*$/m]),
    technology: sectionBody(md, /^(?:#+\s*).*Technology Agent\b.*$/m, [/^(?:#+\s*).*Industry Agent\b.*$/m]),
    industry: sectionBody(md, /^(?:#+\s*).*Industry Agent\b.*$/m, [/^(?:#+\s*).*Policy Agent\b.*$/m]),
    policy: sectionBody(md, /^(?:#+\s*).*Policy Agent\b.*$/m, [/^(?:#+\s*)?3\. Agent 검증\s*$/m]),
    challenger: sectionBody(md, /^(?:#+\s*).*Challenger Agent\b.*$/m, [/^(?:#+\s*)?4\. Agent 종합\s*분석\s*$/m]),
    transition: sectionBody(md, /^(?:#+\s*).*Transition Agent\b.*$/m, [/^(?:#+\s*)?5\. NEXT 전환경로 설계\s*$/m]),
    next_synthesizer: sectionBody(md, /^(?:#+\s*).*NEXT Synthesizer\b.*$/m, [])
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

module.exports = { TEMPLATE_PATH, buildTemplateReport, buildFieldValues, normalizeClickHereNames, normalizeFieldLineBreaks, toReportText, dedupeNumberedSections };
