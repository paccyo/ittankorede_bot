import type { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import nacl from "tweetnacl";

const unauthorized = (): APIGatewayProxyResult => ({
  statusCode: 401,
  body: JSON.stringify({ message: "Unauthorized" })
});

const jsonResponse = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(body)
});

const getHeader = (
  headers: Record<string, string | undefined>,
  name: string
): string | undefined => {
  const lowerName = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lowerName);

  return entry?.[1];
};

const verifySignature = (
  publicKey: string,
  signature: string,
  timestamp: string,
  rawBody: string
): boolean => {
  try {
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + rawBody, "utf8"),
      Buffer.from(signature, "hex"),
      Buffer.from(publicKey, "hex")
    );
  } catch {
    return false;
  }
};

export const handler: APIGatewayProxyHandler = async (event) => {
  const publicKey = process.env.PUBLIC_KEY;

  if (!publicKey) {
    return jsonResponse(500, { message: "Server configuration error" });
  }

  const signature = getHeader(event.headers, "x-signature-ed25519");
  const timestamp = getHeader(event.headers, "x-signature-timestamp");

  if (!signature || !timestamp || event.body === null) {
    return unauthorized();
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  if (!verifySignature(publicKey, signature, timestamp, rawBody)) {
    return unauthorized();
  }

  let payload: { type?: number };

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { message: "Invalid JSON" });
  }

  if (payload.type === 1) {
    return jsonResponse(200, { type: 1 });
  }

  return jsonResponse(200, { message: "Not implemented" });
};
