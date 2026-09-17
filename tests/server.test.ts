import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { test, before, after } from "node:test";
import { WebSocketServer } from "ws";

const projectRoot = join(import.meta.dirname, "..");
const fakeTabId = "fake-tab";
const fakeJpeg = Buffer.from("fake-jpeg");
let cdpServer: ReturnType<typeof createServer>;
let socketServer: WebSocketServer;
let helper: ChildProcess;
let helperPort: number;
let cdpPort: number;
let receivedCommands: string[] = [];

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind");
      resolve(address.port);
    });
  });
}

async function request(path: string, init?: RequestInit) {
  return fetch(`http://127.0.0.1:${helperPort}${path}`, init);
}

before(async () => {
  cdpServer = createServer((request, response) => {
    if (request.url === "/json/list") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify([{
        id: fakeTabId,
        type: "page",
        title: "Test Tab",
        url: "https://example.com/",
        webSocketDebuggerUrl: `ws://127.0.0.1:${cdpPort}/devtools/page/${fakeTabId}`
      }]));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  socketServer = new WebSocketServer({ server: cdpServer });
  socketServer.on("connection", (socket) => {
    socket.on("message", (message) => {
      const command = JSON.parse(message.toString()) as { id: number; method: string };
      receivedCommands.push(command.method);
      socket.send(JSON.stringify({
        id: command.id,
        result: command.method === "Page.captureScreenshot" ? { data: fakeJpeg.toString("base64") } : {}
      }));
    });
  });
  cdpPort = await listen(cdpServer);

  const helperServer = createServer();
  helperPort = await listen(helperServer);
  await new Promise<void>((resolve, reject) => {
    helperServer.close((error) => error ? reject(error) : resolve());
  });

  helper = spawn(process.execPath, [join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"), "src/server.ts"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(helperPort), CHROME_CDP_PORT: String(cdpPort) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  helper.stdout?.on("data", (chunk) => { output += chunk.toString(); });
  helper.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  const started = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Helper did not start: ${output}`)), 10000);
    helper.stdout?.on("data", (chunk) => {
      if (chunk.toString().includes("Chrome Helper listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    helper.once("error", reject);
  });
  await started;
});

after(async () => {
  helper.kill();
  for (const socket of socketServer.clients) socket.terminate();
  await new Promise<void>((resolve, reject) => {
    socketServer.close((error) => error ? reject(error) : resolve());
  });
  await new Promise<void>((resolve, reject) => {
    cdpServer.close((error) => error ? reject(error) : resolve());
  });
});

test("reports a healthy local bridge", async () => {
  const response = await request("/");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { service: "chrome-helper", status: "ok", mode: "local-bridge" });
});

test("repeated duplicate starts preserve the running helper's lock", async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const duplicate = spawn(process.execPath, [join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"), "src/server.ts"], {
      cwd: projectRoot,
      env: { ...process.env, PORT: String(helperPort), CHROME_CDP_PORT: String(cdpPort) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    duplicate.stderr.on("data", chunk => { output += chunk; });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      duplicate.once("error", reject);
      duplicate.once("close", resolve);
    });
    assert.equal(exitCode, 1);
    assert.match(output, /ChromeHelper is already running/);
  }
  assert.equal((await request("/")).status, 200);
});

test("lists tabs from the CDP endpoint", async () => {
  const response = await request("/api/chrome/tabs");
  assert.equal(response.status, 200);
  const tabs = await response.json() as Array<{ id: string; title: string }>;
  assert.equal(tabs[0].id, fakeTabId);
  assert.equal(tabs[0].title, "Test Tab");
});

test("reports the Chrome CDP connection state", async () => {
  const response = await request("/api/chrome/status");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { connected: true, cdpPort, mode: "local-bridge" });
});

test("captures a screenshot through one CDP session", async () => {
  receivedCommands = [];
  const response = await request(`/api/chrome/tabs/${fakeTabId}/screenshot`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), fakeJpeg);
  assert.deepEqual(receivedCommands, ["Page.enable", "Page.captureScreenshot"]);
});

test("sends keyboard input through one CDP session", async () => {
  receivedCommands = [];
  const response = await request(`/api/chrome/tabs/${fakeTabId}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "key", key: "a" })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: true });
  assert.deepEqual(receivedCommands, ["Input.dispatchKeyEvent", "Input.dispatchKeyEvent"]);
});

test("sends mouse input through one CDP session", async () => {
  receivedCommands = [];
  const response = await request(`/api/chrome/tabs/${fakeTabId}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "click", x: 30, y: 20 })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: true });
  assert.deepEqual(receivedCommands, ["Input.dispatchMouseEvent", "Input.dispatchMouseEvent"]);
});

test("rejects malformed input with HTTP 400", async () => {
  const response = await request(`/api/chrome/tabs/${fakeTabId}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{"
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Request body must be valid JSON" });
});
