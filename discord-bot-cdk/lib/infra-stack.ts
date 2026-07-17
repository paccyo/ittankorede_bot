import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

/** Infrastructure stack. Resources will be added as the bot is deployed to AWS. */
export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
  }
}
