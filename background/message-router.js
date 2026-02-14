import { ERROR_CODES, createError } from "../shared/protocol.js";

export async function routeMessage(message, handlers) {
  if (!message || typeof message.type !== "string") {
    return createError(ERROR_CODES.BAD_REQUEST, "Invalid runtime message.");
  }

  const handler = handlers[message.type];
  if (typeof handler !== "function") {
    return createError(ERROR_CODES.BAD_REQUEST, `Unsupported message type: ${message.type}`);
  }

  return handler(message);
}
