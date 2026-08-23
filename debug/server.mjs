import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BODY_BYTES = 1_000_000;
const TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
]);

/** Load a local dotenv file without replacing variables already supplied by the shell. */
export function loadEnvFile(filename, environment = process.env) {
  let source;
  try {
    source = readFileSync(filename, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) throw new SyntaxError(`Invalid environment entry in ${filename}:${index + 1}.`);
    const [, name, rawValue] = match;
    if (environment[name] !== undefined) continue;
    environment[name] = dotenvValue(rawValue);
  }
  return true;
}

function dotenvValue(rawValue) {
  if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
    return rawValue.slice(1, -1);
  }
  return rawValue.replace(/\s+#.*$/, "").trim();
}

export function createDebugServer({
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
  root = PROJECT_ROOT,
} = {}) {
  const upstreamFetch = fetchImpl?.bind(globalThis);
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/api/responses") {
        await proxyResponse({ request, response, apiKey, fetchImpl: upstreamFetch });
        return;
      }
      await serveFile({ request, response, pathname: url.pathname, root });
    } catch (error) {
      console.error(error);
      if (!response.headersSent) sendJson(response, error.statusCode ?? 500, { error: error.message ?? String(error) });
      else response.destroy();
    }
  });
}

async function proxyResponse({ request, response, apiKey, fetchImpl }) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });
  if (!apiKey) return sendJson(response, 500, { error: "OPENAI_API_KEY is not configured on the debug server." });
  if (typeof fetchImpl !== "function") return sendJson(response, 500, { error: "The debug server requires fetch." });

  const body = await readBody(request);
  const upstream = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body,
  });
  const headers = {
    "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  for (const [name, value] of upstream.headers) {
    if (name === "x-request-id" || name === "openai-processing-ms" || name.startsWith("x-ratelimit-")) {
      headers[name] = value;
    }
  }
  response.writeHead(upstream.status, headers);
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function serveFile({ request, response, pathname, root }) {
  if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "Method not allowed." });
  if (pathname === "/") {
    response.writeHead(302, { Location: "/app/" });
    response.end();
    return;
  }

  const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (relative.split("/").some((segment) => segment.startsWith("."))) {
    return sendJson(response, 404, { error: "Not found." });
  }
  let filename = resolve(root, relative);
  if (filename !== root && !filename.startsWith(root + sep)) return sendJson(response, 403, { error: "Forbidden." });

  let details;
  try {
    details = await stat(filename);
    if (details.isDirectory()) {
      filename = resolve(filename, "index.html");
      details = await stat(filename);
    }
  } catch {
    return sendJson(response, 404, { error: "Not found." });
  }
  if (!details.isFile()) return sendJson(response, 404, { error: "Not found." });

  response.writeHead(200, {
    "Content-Type": TYPES.get(extname(filename)) ?? "application/octet-stream",
    "Content-Length": details.size,
    "Cache-Control": "no-store",
  });
  if (request.method === "HEAD") return response.end();
  createReadStream(filename).pipe(response);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  response.end(body);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), ".env"));
  const port = Number(process.env.PORT ?? 4173);
  createDebugServer().listen(port, "127.0.0.1", () => {
    console.log(`Pixel Conversations: http://localhost:${port}/app/`);
    console.log(`State debugger: http://localhost:${port}/debug/`);
    if (!process.env.OPENAI_API_KEY) console.warn("OPENAI_API_KEY is not set; simulation requests will fail.");
  });
}
