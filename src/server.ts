import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";

const port = Number(process.env.PORT ?? 4320);
const cdpPort = Number(process.env.CHROME_CDP_PORT ?? 9222);
const chromeShareOrigin = process.env.CHROME_SHARE_ORIGIN ?? "http://localhost:5173";
const cdpRequestTimeoutMs = 5000;

class InvalidRequestError extends Error {}

interface ChromeTab {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

async function chromeRequest<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${cdpPort}${path}`, { signal: AbortSignal.timeout(cdpRequestTimeoutMs) });
  } catch {
    throw new Error(`Chrome CDP is unavailable on port ${cdpPort}`);
  }
  if (!response.ok) throw new Error(`Chrome CDP returned ${response.status}`);
  return response.json() as Promise<T>;
}

function sendCommands(tab: ChromeTab, commands: Array<{ method: string; params?: Record<string, unknown> }>) {
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    let commandIndex = 0;
    let nextId = 1;
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Chrome command timed out: ${commands[commandIndex]?.method ?? "unknown"}`));
    }, 10000);
    const sendNext = () => {
      const command = commands[commandIndex];
      if (!command) {
        clearTimeout(timeout);
        socket.close();
        resolve();
        return;
      }
      socket.send(JSON.stringify({ id: nextId, method: command.method, params: command.params ?? {} }));
    };
    socket.once("open", sendNext);
    socket.on("message", (message) => {
      const response = JSON.parse(message.toString()) as { id?: number; error?: { message: string } };
      if (response.id !== nextId) return;
      if (response.error) {
        clearTimeout(timeout);
        socket.close();
        reject(new Error(response.error.message));
        return;
      }
      commandIndex += 1;
      nextId += 1;
      sendNext();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      socket.close();
      reject(error);
    });
  });
}

function captureScreenshot(tab: ChromeTab) {
  return new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    let nextId = 1;
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Chrome screenshot command timed out"));
    }, 10000);
    socket.once("open", () => socket.send(JSON.stringify({ id: nextId, method: "Page.enable" })));
    socket.on("message", (message) => {
      const response = JSON.parse(message.toString()) as { id?: number; result?: { data?: string }; error?: { message: string } };
      if (response.id !== nextId) return;
      if (response.error) {
        clearTimeout(timeout);
        socket.close();
        reject(new Error(response.error.message));
        return;
      }
      if (nextId === 1) {
        nextId = 2;
        socket.send(JSON.stringify({ id: nextId, method: "Page.captureScreenshot", params: { format: "jpeg", quality: 75 } }));
        return;
      }
      clearTimeout(timeout);
      socket.close();
      if (!response.result?.data) reject(new Error("Chrome returned an empty screenshot"));
      else resolve(response.result.data);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      socket.close();
      reject(error);
    });
  });
}

async function findTab(tabId: string) {
  const tabs = await chromeRequest<ChromeTab[]>("/json/list");
  const tab = tabs.find((item) => item.id === tabId) ?? tabs.find((item) => item.type === "page");
  if (!tab) throw new Error("No Chrome page tab available");
  return tab;
}

async function launchChrome() {
  const chromeCandidates = [
    `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`
  ];
  const executable = chromeCandidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) throw new Error("Chrome executable was not found");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [
      `--remote-debugging-port=${cdpPort}`,
      "--remote-allow-origins=http://localhost:4320",
      `--user-data-dir=${tmpdir()}\\DeskFluxChrome`,
      "about:blank"
    ], { windowsHide: true, detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function readBody(request: import("node:http").IncomingMessage) {
  let body = "";
  for await (const chunk of request) body += chunk;
  if (body.length > 1024 * 1024) throw new InvalidRequestError("Request body is too large");
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new InvalidRequestError("Request body must be valid JSON");
  }
}

const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", chromeShareOrigin);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200);
      response.end(JSON.stringify({ service: "chrome-helper", status: "ok", mode: "local-bridge" }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/chrome/tabs") {
      const tabs = await chromeRequest<ChromeTab[]>("/json/list");
      response.writeHead(200);
      response.end(JSON.stringify(tabs));
      return;
    }
    if (request.method === "POST" && request.url === "/api/chrome/launch") {
      await launchChrome();
      response.writeHead(202);
      response.end(JSON.stringify({ started: true, cdpPort }));
      return;
    }

    const tabMatch = request.url?.match(/^\/api\/chrome\/tabs\/([^/]+)\/(screenshot|input)$/);
    if (tabMatch) {
      const tab = await findTab(decodeURIComponent(tabMatch[1]));
      if (request.method === "GET" && tabMatch[2] === "screenshot") {
        const data = await captureScreenshot(tab);
        response.setHeader("Content-Type", "image/jpeg");
        response.writeHead(200);
        response.end(Buffer.from(data, "base64"));
        return;
      }
      if (request.method === "POST" && tabMatch[2] === "input") {
        const input = await readBody(request) as { type: "click" | "doubleClick" | "rightClick" | "key"; x?: number; y?: number; key?: string };
        if (input.type === "key" && input.key) {
          await sendCommands(tab, [
            { method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: input.key, text: input.key.length === 1 ? input.key : undefined } },
            { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: input.key } }
          ]);
        } else if (["click", "doubleClick", "rightClick"].includes(input.type) && typeof input.x === "number" && typeof input.y === "number" && Number.isFinite(input.x) && Number.isFinite(input.y)) {
          const clickCount = input.type === "doubleClick" ? 2 : 1;
          const button = input.type === "rightClick" ? "right" : "left";
          await sendCommands(tab, [
            { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: input.x, y: input.y, button, clickCount } },
            { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: input.x, y: input.y, button, clickCount } }
          ]);
        } else {
          throw new InvalidRequestError("Invalid Chrome input");
        }
        response.writeHead(200);
        response.end(JSON.stringify({ sent: true }));
        return;
      }
    }

    response.writeHead(404);
    response.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    console.error(error);
    const status = error instanceof InvalidRequestError ? 400 : 503;
    response.writeHead(status);
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Chrome helper unavailable" }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Chrome Helper listening on http://127.0.0.1:${port}`);
});
