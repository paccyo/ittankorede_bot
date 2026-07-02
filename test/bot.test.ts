import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import nacl from "tweetnacl";
import { handler } from "../src/bot";

const keyPair = nacl.sign.keyPair();
const publicKey = Buffer.from(keyPair.publicKey).toString("hex");

const buildEvent = (
  body: string,
  headers: Record<string, string> = {}
): APIGatewayProxyEvent =>
  ({
    body,
    headers,
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/interactions",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {},
    resource: "/interactions"
  }) as APIGatewayProxyEvent;

const signedHeaders = (body: string): Record<string, string> => {
  const timestamp = "1710000000";
  const signature = nacl.sign.detached(
    Buffer.from(timestamp + body, "utf8"),
    keyPair.secretKey
  );

  return {
    "x-signature-ed25519": Buffer.from(signature).toString("hex"),
    "x-signature-timestamp": timestamp
  };
};

describe("handler", () => {
  const originalPublicKey = process.env.PUBLIC_KEY;

  beforeEach(() => {
    process.env.PUBLIC_KEY = publicKey;
  });

  afterAll(() => {
    process.env.PUBLIC_KEY = originalPublicKey;
  });

  const invokeHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> =>
    (await handler(event, {} as never, jest.fn())) as APIGatewayProxyResult;

  it("returns pong response for a valid Discord ping request", async () => {
    const body = JSON.stringify({ type: 1 });
    const response = await invokeHandler(buildEvent(body, signedHeaders(body)));

    expect(response).toMatchObject({
      statusCode: 200,
      body: JSON.stringify({ type: 1 })
    });
  });

  it("returns unauthorized for an invalid signature", async () => {
    const body = JSON.stringify({ type: 1 });
    const response = await invokeHandler(
      buildEvent(body, {
        ...signedHeaders(body),
        "x-signature-ed25519": "00"
      })
    );

    expect(response).toMatchObject({
      statusCode: 401,
      body: JSON.stringify({ message: "Unauthorized" })
    });
  });

  it("returns unauthorized when signature headers are missing", async () => {
    const body = JSON.stringify({ type: 1 });
    const response = await invokeHandler(buildEvent(body));

    expect(response).toMatchObject({
      statusCode: 401,
      body: JSON.stringify({ message: "Unauthorized" })
    });
  });

  it("returns server error when PUBLIC_KEY is not configured", async () => {
    delete process.env.PUBLIC_KEY;

    const body = JSON.stringify({ type: 1 });
    const response = await invokeHandler(buildEvent(body, signedHeaders(body)));

    expect(response).toMatchObject({
      statusCode: 500,
      body: JSON.stringify({ message: "Server configuration error" })
    });
  });
});
