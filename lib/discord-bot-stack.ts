import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export interface DiscordBotStackProps extends cdk.StackProps {
  publicKey: string;
}

export class DiscordBotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DiscordBotStackProps) {
    super(scope, id, props);

    const botFunction = new NodejsFunction(this, "DiscordInteractionsFunction", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "../src/bot.ts"),
      handler: "handler",
      environment: {
        PUBLIC_KEY: props.publicKey
      }
    });

    const api = new apigateway.RestApi(this, "DiscordInteractionsApi", {
      restApiName: "discord-interactions-api"
    });

    const interactions = api.root.addResource("interactions");
    interactions.addMethod(
      "POST",
      new apigateway.LambdaIntegration(botFunction, {
        proxy: true
      })
    );
  }
}
