import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANGUAGE = JSON.parse(fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8"));

test("the English localization catalog has no duplicate keys", () => {
  const source = fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8");
  const keys = [...source.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((match) => match[1]);
  const duplicates = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  assert.deepEqual(duplicates, []);
});

function filesUnder(directory, extensions) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (extensions.some((extension) => target.endsWith(extension))) files.push(target);
    }
  };
  visit(path.join(ROOT, directory));
  return files;
}

test("every literal localization key used by the system exists", () => {
  const files = [
    ...filesUnder("templates", [".hbs"]),
    ...filesUnder("module", [".mjs"]),
    ...filesUnder("migrations", [".mjs"])
  ];
  const missing = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/["']((?:LYRIAN|TYPES)\.[A-Za-z0-9_.-]+)["']/g)) {
      if (!match[1].endsWith(".") && !(match[1] in LANGUAGE)) {
        missing.push(`${path.relative(ROOT, file)}: ${match[1]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("Handlebars templates contain no hard-coded interface prose", () => {
  const offenders = [];
  for (const file of filesUnder("templates", [".hbs"])) {
    const source = fs.readFileSync(file, "utf8");
    const relative = path.relative(ROOT, file);
    const withoutExpressions = source.replace(/\{\{[\s\S]*?\}\}/g, "");
    for (const match of withoutExpressions.matchAll(/>([^<>]+)</g)) {
      const text = match[1]
        .replace(/&[a-z]+;/gi, "")
        .replace(/\b\d+d\d+\b/gi, "")
        .trim();
      if (/[A-Za-z]/.test(text)) offenders.push(`${relative}: ${text}`);
    }
    for (const match of source.matchAll(/(?:title|aria-label|placeholder)="(?!\{\{)([^"]*[A-Za-z][^"]*)"/g)) {
      offenders.push(`${relative}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("notifications and dialog titles do not use literal English strings", () => {
  const offenders = [];
  const files = [
    ...filesUnder("module", [".mjs"]),
    ...filesUnder("migrations", [".mjs"])
  ];
  const patterns = [
    /ui\.notifications\.(?:warn|info|error)\(\s*(["'`])([^\n]*?)\1/g,
    /window:\s*\{\s*title:\s*(["'`])([^\n]*?)\1/g
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        if (!/^(?:LYRIAN|TYPES)\./.test(match[2])) {
          offenders.push(`${path.relative(ROOT, file)}: ${match[2]}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});
