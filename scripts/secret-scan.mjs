import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const patterns = [
  { name: "GitHub classic token", regex: /ghp_[A-Za-z0-9]{20,}/g },
  { name: "GitHub fine-grained token", regex: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: "NVIDIA API key", regex: /nvapi-[A-Za-z0-9_-]{20,}/g },
  { name: "OpenAI-style API key", regex: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: "AWS access key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "Private key material", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

const findings = [];
for (const file of files) {
  let content;
  try { content = readFileSync(file, "utf8"); }
  catch { continue; }
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(content)) findings.push(`${pattern.name}: ${file}`);
  }
}

if (findings.length) {
  console.error("High-confidence secret scan failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`High-confidence secret scan PASS (${files.length} tracked files checked)`);
