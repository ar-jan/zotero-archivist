import test from "node:test";
import assert from "node:assert/strict";

import { routeMessage } from "../background/message-router.js";
import { MESSAGE_TYPES } from "../shared/protocol.js";

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

test("message router rejects payload on payloadless messages", async () => {
  const response = await routeMessage(
    {
      type: MESSAGE_TYPES.GET_PANEL_STATE,
      payload: {}
    },
    {
      [MESSAGE_TYPES.GET_PANEL_STATE]: async () => ({ ok: true })
    }
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "BAD_REQUEST");
  assert.match(response.error.message, /does not accept a payload/i);
});

test("message router treats reverse queue as payloadless", async () => {
  const invalidResponse = await routeMessage(
    {
      type: MESSAGE_TYPES.REVERSE_QUEUE,
      payload: {}
    },
    {
      [MESSAGE_TYPES.REVERSE_QUEUE]: async () => ({ ok: true })
    }
  );

  assert.equal(invalidResponse.ok, false);
  assert.equal(invalidResponse.error.code, "BAD_REQUEST");
  assert.match(invalidResponse.error.message, /does not accept a payload/i);

  const validResponse = await routeMessage(
    {
      type: MESSAGE_TYPES.REVERSE_QUEUE
    },
    {
      [MESSAGE_TYPES.REVERSE_QUEUE]: async () => ({ ok: true })
    }
  );

  assert.equal(validResponse.ok, true);
});

test("message router validates array payload contracts", async () => {
  const invalidResponse = await routeMessage(
    {
      type: MESSAGE_TYPES.SET_COLLECTED_LINKS,
      payload: {}
    },
    {
      [MESSAGE_TYPES.SET_COLLECTED_LINKS]: async () => ({ ok: true })
    }
  );

  assert.equal(invalidResponse.ok, false);
  assert.equal(invalidResponse.error.code, "BAD_REQUEST");
  assert.match(invalidResponse.error.message, /payload\.links/i);

  const validResponse = await routeMessage(
    {
      type: MESSAGE_TYPES.SET_COLLECTED_LINKS,
      payload: { links: [] }
    },
    {
      [MESSAGE_TYPES.SET_COLLECTED_LINKS]: async () => ({ ok: true })
    }
  );

  assert.equal(validResponse.ok, true);
});

test("message router validates object payload contracts", async () => {
  const invalidResponse = await routeMessage(
    {
      type: MESSAGE_TYPES.SET_QUEUE_SETTINGS,
      payload: {}
    },
    {
      [MESSAGE_TYPES.SET_QUEUE_SETTINGS]: async () => ({ ok: true })
    }
  );

  assert.equal(invalidResponse.ok, false);
  assert.equal(invalidResponse.error.code, "BAD_REQUEST");
  assert.match(invalidResponse.error.message, /payload\.queueSettings/i);

  const validResponse = await routeMessage(
    {
      type: MESSAGE_TYPES.SET_QUEUE_SETTINGS,
      payload: { queueSettings: { interItemDelayMs: 5000, interItemDelayJitterMs: 2000 } }
    },
    {
      [MESSAGE_TYPES.SET_QUEUE_SETTINGS]: async () => ({ ok: true })
    }
  );

  assert.equal(validResponse.ok, true);
});
