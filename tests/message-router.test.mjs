import test from "node:test";
import assert from "node:assert/strict";

import { routeMessage } from "../background/message-router.js";

test("message router rejects missing message type", async () => {
  const response = await routeMessage({}, {});

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "BAD_REQUEST");
  assert.match(response.error.message, /invalid runtime message/i);
});

test("message router rejects unsupported message type", async () => {
  const response = await routeMessage({ type: "UNKNOWN" }, {});

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "BAD_REQUEST");
  assert.match(response.error.message, /unsupported message type/i);
});

test("message router delegates to matching handler", async () => {
  const handlers = {
    PING: async (message) => ({
      ok: true,
      echoedType: message.type
    })
  };

  const response = await routeMessage({ type: "PING" }, handlers);

  assert.equal(response.ok, true);
  assert.equal(response.echoedType, "PING");
});
