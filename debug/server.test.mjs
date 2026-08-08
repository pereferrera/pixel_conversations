import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDebugServer } from "./server.mjs";

async function start(options) {
  const server = createDebugServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function stop(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("debug proxy adds the server-side API key and relays the response", async () => {
  let forwarded;
  const fetchImpl = async (url, init) => {
    forwarded = { url, init };
    return new Response('{"output_text":"ok"}', {
      status: 201,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "req_test",
        "openai-processing-ms": "42",
      },
    });
  };
  const { server, origin } = await start({ apiKey: "server-secret", fetchImpl });
  try {
    const response = await fetch(`${origin}/api/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"model":"test-model"}',
    });
    assert.equal(response.status, 201);
    assert.equal(forwarded.url, "https://api.openai.com/v1/responses");
    assert.equal(forwarded.init.headers.Authorization, "Bearer server-secret");
    assert.equal(forwarded.init.body.toString(), '{"model":"test-model"}');
    assert.equal(response.headers.get("x-request-id"), "req_test");
    assert.equal(response.headers.get("openai-processing-ms"), "42");
    assert.deepEqual(await response.json(), { output_text: "ok" });
  } finally {
    await stop(server);
  }
});

test("debug proxy reports a missing server-side API key", async () => {
  const { server, origin } = await start({ apiKey: "" });
  try {
    const response = await fetch(`${origin}/api/responses`, { method: "POST", body: "{}" });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /OPENAI_API_KEY/);
  } finally {
    await stop(server);
  }
});

test("debug server serves the browser app from loopback", async () => {
  const { server, origin } = await start({ apiKey: "unused" });
  try {
    const response = await fetch(`${origin}/debug/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /State machine debugger/);
  } finally {
    await stop(server);
  }
});

test("example world uses the real community cafe runtime positions", async () => {
  const scene = JSON.parse(await readFile(new URL("../scenes/community-cafe/scene.json", import.meta.url)));
  const example = JSON.parse(await readFile(new URL("./example-world.json", import.meta.url)));
  assert.equal(example.scene.id, scene.id);
  assert.deepEqual(example.scene.positions, scene.positions);
  assert.equal(example.state.sceneId, scene.id);
  assert.equal(example.profiles.find(({ id }) => id === "felix-adebayo").assetStatus.kind, "production");
  assert.equal(example.profiles.find(({ id }) => id === "grace-kim").assetStatus.kind, "production");
  assert.equal(example.rendering.sceneDefinition, "/scenes/community-cafe/scene.json");
  assert.match(example.rendering.characterManifests["grace-kim"], /grace-kim\/manifest\.json$/);
});
