import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDebugServer, loadEnvFile } from "./server.mjs";

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

test("debug dotenv loader reads values without overriding the shell environment", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pixel-conversations-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, ".env");
  await writeFile(filename, [
    "# local debug credentials",
    "OPENAI_API_KEY='file-secret'",
    "PORT=9999 # optional override",
    "export EMPTY_VALUE=",
  ].join("\n"));
  const environment = { OPENAI_API_KEY: "shell-secret" };

  assert.equal(loadEnvFile(filename, environment), true);
  assert.deepEqual(environment, {
    OPENAI_API_KEY: "shell-secret",
    PORT: "9999",
    EMPTY_VALUE: "",
  });
});

test("debug dotenv loader treats a missing file as optional", () => {
  assert.equal(loadEnvFile("/tmp/pixel-conversations-missing-env-file", {}), false);
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

test("debug server never serves dotenv files or other dotfiles", async () => {
  const { server, origin } = await start({ apiKey: "unused" });
  try {
    assert.equal((await fetch(`${origin}/debug/.env`)).status, 404);
    assert.equal((await fetch(`${origin}/.gitignore`)).status, 404);
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

test("every scene provides at least twenty standing and seated runtime positions", async () => {
  for (const path of ["../scenes/community-cafe/scene.json", "../scenes/museum-reading-room/scene.json"]) {
    const scene = JSON.parse(await readFile(new URL(path, import.meta.url)));
    assert.ok(scene.positions.length >= 20, `${scene.id} has only ${scene.positions.length} positions`);
    assert.ok(scene.positions.some(({ kind }) => kind === "standing"), `${scene.id} has no standing positions`);
    assert.ok(scene.positions.some(({ kind }) => kind === "seat"), `${scene.id} has no seated positions`);
    assert.equal(new Set(scene.positions.map(({ id }) => id)).size, scene.positions.length, `${scene.id} has duplicate position ids`);
    const ids = new Set(scene.positions.map(({ id }) => id));
    for (const pair of scene.conversationPairs) {
      assert.ok(pair.positions.every((id) => ids.has(id)), `${scene.id} has a conversation pair with an unknown position`);
    }
  }
});
