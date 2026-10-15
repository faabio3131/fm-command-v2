import { spawn } from "node:child_process";

const runtimePort = process.env.FMCC_RUNTIME_PORT ?? "3000";
const baseUrl = `http://127.0.0.1:${runtimePort}`;
let output = "";

const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", runtimePort],
  {
    env: { ...process.env, NODE_ENV: "production", PORT: runtimePort },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

server.stdout.on("data", (chunk) => { output += String(chunk); });
server.stderr.on("data", (chunk) => { output += String(chunk); });

async function fetchWithTimeout(path, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    return await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

async function waitUntilReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout("/api/health");
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`runtime server did not become healthy\n${output.slice(-4000)}`);
}

async function expectJson(path, expectedStatus, predicate, init) {
  const response = await fetchWithTimeout(path, init);
  if (response.status !== expectedStatus) {
    throw new Error(`${path}: expected HTTP ${expectedStatus}, got ${response.status}\n${output.slice(-2000)}`);
  }
  const payload = await response.json();
  if (!predicate(payload)) throw new Error(`${path}: unexpected payload ${JSON.stringify(payload)}`);
}

async function expectStatus(path, expectedStatus, init) {
  const response = await fetchWithTimeout(path, init);
  if (response.status !== expectedStatus) {
    throw new Error(`${path}: expected HTTP ${expectedStatus}, got ${response.status}`);
  }
  return response;
}

function expectSecurityHeaders(response, path) {
  const expected = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(self), geolocation=()",
  };
  for (const [name, value] of Object.entries(expected)) {
    const actual = response.headers.get(name);
    if (actual !== value) {
      throw new Error(`${path}: expected ${name}=${value}, got ${actual}`);
    }
  }
}

async function stopServer() {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (server.exitCode === null) {
    server.kill("SIGKILL");
    await exited;
  }
}

try {
  await waitUntilReady();

  await expectJson("/api/health", 200, (p) => p?.service === "fm-control-center" && p?.status === "ok");
  await expectJson("/api/ready", 200, (p) => p?.status === "ready");
  const home = await expectStatus("/", 200);
  expectSecurityHeaders(home, "/");
  const signIn = await expectStatus("/sign-in", 200);
  expectSecurityHeaders(signIn, "/sign-in");

  await expectStatus("/api/me", 401);
  await expectStatus("/api/alerts", 401);
  await expectStatus("/api/intelligence/executive", 401);
  await expectStatus("/api/core/query", 401, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "smoke" }),
  });

  console.log("FMCC runtime smoke PASS");
} finally {
  await stopServer();
}
