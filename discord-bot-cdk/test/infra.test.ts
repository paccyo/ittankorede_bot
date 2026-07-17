import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { InfraStack } from '../lib/infra-stack';

// example test. To run these tests, uncomment this file along with the
// example resource in lib/infra-stack.ts
test('stack can be synthesized', () => {
  const app = new cdk.App();
  const stack = new InfraStack(app, 'MyTestStack');

  expect(Template.fromStack(stack).toJSON()).toEqual({ Resources: {} });
});
