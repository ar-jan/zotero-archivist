import { ERROR_CODES, MESSAGE_TYPES, createError } from "../shared/protocol.js";

const PAYLOADLESS_MESSAGE_TYPES = new Set([
  MESSAGE_TYPES.GET_PANEL_STATE,
  MESSAGE_TYPES.COLLECT_LINKS,
  MESSAGE_TYPES.CLEAR_QUEUE,
  MESSAGE_TYPES.START_QUEUE,
  MESSAGE_TYPES.PAUSE_QUEUE,
  MESSAGE_TYPES.RESUME_QUEUE,
  MESSAGE_TYPES.STOP_QUEUE,
  MESSAGE_TYPES.RETRY_FAILED_QUEUE
]);

const ARRAY_PAYLOAD_CONTRACTS = Object.freeze({
  [MESSAGE_TYPES.SET_COLLECTED_LINKS]: "links",
  [MESSAGE_TYPES.AUTHOR_QUEUE_FROM_SELECTION]: "links",
  [MESSAGE_TYPES.SET_SELECTOR_RULES]: "rules"
});

export async function routeMessage(message, handlers) {
  if (!message || typeof message !== "object" || typeof message.type !== "string") {
    return createError(ERROR_CODES.BAD_REQUEST, "Invalid runtime message.");
  }

  const handler = handlers[message.type];
  if (typeof handler !== "function") {
    return createError(ERROR_CODES.BAD_REQUEST, `Unsupported message type: ${message.type}`);
  }

  const payloadValidationError = validateMessagePayload(message);
  if (payloadValidationError) {
    return createError(ERROR_CODES.BAD_REQUEST, payloadValidationError);
  }

  return handler(message);
}

function validateMessagePayload(message) {
  if (PAYLOADLESS_MESSAGE_TYPES.has(message.type)) {
    if (message.payload !== undefined) {
      return `Message type ${message.type} does not accept a payload.`;
    }
    return null;
  }

  const arrayPayloadField = ARRAY_PAYLOAD_CONTRACTS[message.type];
  if (!arrayPayloadField) {
    return null;
  }

  if (!isPlainObject(message.payload)) {
    return `Message type ${message.type} requires a payload object.`;
  }

  if (!Array.isArray(message.payload[arrayPayloadField])) {
    return `Message type ${message.type} requires payload.${arrayPayloadField} to be an array.`;
  }

  return null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
