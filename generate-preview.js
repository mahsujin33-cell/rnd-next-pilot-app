"use strict";

const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("styles.css", "utf8");
const model = fs.readFileSync("project-model.js", "utf8");
const app = fs.readFileSync("app.js", "utf8");

const preview = html
  .replace(/  <link rel="stylesheet" href="styles\.css\?v=[^"]+">/, `  <style>\n${css}\n  </style>`)
  .replace(/  <script src="project-model\.js\?v=[^"]+"><\/script>\n  <script src="app\.js\?v=[^"]+"><\/script>/, `  <script>\n${model}\n\n${app}\n  </script>`);

if (preview === html || /(?:styles|project-model|app)\.js\?v=/.test(preview)) {
  throw new Error("preview inline replacement failed");
}
fs.writeFileSync("preview.html", preview);
console.log("preview.html regenerated");
