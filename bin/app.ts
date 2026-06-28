#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DiscordBotStack } from "../lib/discord-bot-stack";

const app = new cdk.App();

new DiscordBotStack(app, "DiscordBotStack", {
  publicKey: app.node.tryGetContext("publicKey") ?? process.env.PUBLIC_KEY ?? ""
});
