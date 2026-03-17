import { resolve } from 'node:path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import type { SubgraphCommandJsonOutput } from 'wgc/dist/src/core/types/types';
import { addComment } from '../utils';
import {
  getRemovedGraphQLFilesInLastCommit,
  hasCosmoConfigChangedInLastCommit,
} from '../githubFiles';
import type { FeatureSubgraphsOutputConfig, Inputs } from '../types';

type Context = typeof github.context;

export const checkConfigChanged = async ({
  inputs,
  prNumber,
  context,
}: {
  inputs: Inputs;
  prNumber: number;
  context: Context;
}): Promise<boolean> => {
  const isCosmoConfigChanged = await hasCosmoConfigChangedInLastCommit({
    githubToken: inputs.githubToken,
    prNumber,
  });

  if (isCosmoConfigChanged) {
    const octokit = github.getOctokit(inputs.githubToken);
    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body: `❌  The Cosmo configuration file has been modified. Please close and reopen the pull request. Failing to do so may cause the feature flag to function improperly. Please make sure that the destroy job(triggered when the PR is closed) is completed before reopening the pull request.`,
    });
    core.setFailed('Cosmo config file is changed. Please close and reopen the pr.');
    return true;
  }

  return false;
};

export const previewCreate = async ({
  inputs,
  prNumber,
  changedGraphQLFiles,
  context,
  organizationSlug,
}: {
  inputs: Inputs;
  prNumber: number;
  changedGraphQLFiles: string[];
  context: Context;
  organizationSlug: string;
}): Promise<void> => {
  const deployedFeatureFlags: string[] = [];
  const featureFlagErrorOutputs: Record<string, SubgraphCommandJsonOutput> = {};
  const allFeatureSubgraphNames: string[] = [];
  const featureSubgraphsToDeploy: FeatureSubgraphsOutputConfig[] = [];

  for (const preview of inputs.previews) {
    const featureSubgraphNames: string[] = [];

    for (const previewSubgraph of preview.subgraphs) {
      const subgraphConfig = inputs.subgraphs.find((s) => s.name === previewSubgraph.name);
      if (!subgraphConfig) {
        continue;
      }

      const isChanged = changedGraphQLFiles.some(
        (f) => resolve(process.cwd(), f) === subgraphConfig.schema_path,
      );
      if (!isChanged) {
        continue;
      }

      const featureSubgraphName = `${previewSubgraph.name}-${preview.namespace}-${prNumber}`;
      const routingURL = previewSubgraph.routing_url.replaceAll(
        '${PR_NUMBER}',
        prNumber.toString(),
      );
      const command = `wgc feature-subgraph publish ${featureSubgraphName} --subgraph ${previewSubgraph.name} --routing-url ${routingURL} --schema ${subgraphConfig.schema_path} -n ${preview.namespace}`;
      await exec.exec(command);
      featureSubgraphNames.push(featureSubgraphName);
      featureSubgraphsToDeploy.push({
        previewName: preview.name,
        namespace: preview.namespace,
        featureSubgraphName,
        schemaPath: subgraphConfig.schema_path,
        routingUrl: routingURL,
        baseSubgraphName: previewSubgraph.name,
      });
    }

    allFeatureSubgraphNames.push(...featureSubgraphNames);

    if (featureSubgraphNames.length === 0) {
      continue;
    }

    const featureFlagName = `${preview.name}-${prNumber}`;
    const command = `wgc feature-flag create ${featureFlagName} -n ${preview.namespace} --label ${preview.labels.join(' ')} --feature-subgraphs ${featureSubgraphNames.join(' ')} --enabled --json`;
    let output = '';
    let error = '';
    const options = {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
        stderr: (data: Buffer) => {
          error += data.toString();
        },
      },
    };
    await exec.exec(command, [], options);
    if (error) {
      const errorJsonOutput: SubgraphCommandJsonOutput = JSON.parse(error);
      featureFlagErrorOutputs[featureFlagName] = errorJsonOutput;
      continue;
    }
    if (output) {
      const jsonOutput: SubgraphCommandJsonOutput = JSON.parse(output);
      if (jsonOutput.status === 'success') {
        deployedFeatureFlags.push(featureFlagName);
      } else {
        featureFlagErrorOutputs[featureFlagName] = jsonOutput;
      }
    }
  }

  core.setOutput('feature_subgraphs_to_deploy', featureSubgraphsToDeploy);

  if (allFeatureSubgraphNames.length === 0) {
    core.info('No subgraphs found to create feature subgraphs.');
    return;
  }

  await addComment({
    githubToken: inputs.githubToken,
    prNumber,
    deployedFeatureFlags,
    featureSubgraphs: allFeatureSubgraphNames,
    featureFlagErrorOutputs,
    context,
    organizationSlug,
    previews: inputs.previews,
  });
};

export const previewUpdate = async ({
  inputs,
  prNumber,
  changedGraphQLFiles,
  context,
  organizationSlug,
}: {
  inputs: Inputs;
  prNumber: number;
  changedGraphQLFiles: string[];
  context: Context;
  organizationSlug: string;
}): Promise<void> => {
  const deployedFeatureFlags: string[] = [];
  const featureFlagErrorOutputs: Record<string, SubgraphCommandJsonOutput> = {};
  const allFeatureSubgraphNames: string[] = [];
  const featureSubgraphsToDeploy: FeatureSubgraphsOutputConfig[] = [];
  const featureSubgraphsToDestroy: FeatureSubgraphsOutputConfig[] = [];

  const removedGraphQLFiles = await getRemovedGraphQLFilesInLastCommit({
    githubToken: inputs.githubToken,
    prNumber,
    changedGraphQLFilesInPr: changedGraphQLFiles,
  });

  for (const preview of inputs.previews) {
    const featureSubgraphNames: string[] = [];

    // Delete feature subgraphs for files removed in the last commit
    for (const removedFile of removedGraphQLFiles) {
      const previewSubgraph = preview.subgraphs.find((ps) => {
        const sc = inputs.subgraphs.find((s) => s.name === ps.name);
        return sc && resolve(process.cwd(), removedFile) === sc.schema_path;
      });
      if (!previewSubgraph) {
        continue;
      }

      const subgraphConfig = inputs.subgraphs.find((s) => s.name === previewSubgraph.name);
      if (!subgraphConfig) {
        continue;
      }

      const featureSubgraphName = `${previewSubgraph.name}-${preview.namespace}-${prNumber}`;
      const routingURL = previewSubgraph.routing_url.replaceAll(
        '${PR_NUMBER}',
        prNumber.toString(),
      );
      const command = `wgc subgraph delete ${featureSubgraphName} -n ${preview.namespace} -f`;
      await exec.exec(command);
      featureSubgraphsToDestroy.push({
        previewName: preview.name,
        namespace: preview.namespace,
        featureSubgraphName,
        schemaPath: subgraphConfig.schema_path,
        routingUrl: routingURL,
        baseSubgraphName: previewSubgraph.name,
      });
    }

    // Publish changed feature subgraphs
    for (const previewSubgraph of preview.subgraphs) {
      const subgraphConfig = inputs.subgraphs.find((s) => s.name === previewSubgraph.name);
      if (!subgraphConfig) {
        continue;
      }

      const isChanged = changedGraphQLFiles.some(
        (f) => resolve(process.cwd(), f) === subgraphConfig.schema_path,
      );
      if (!isChanged) {
        continue;
      }

      const featureSubgraphName = `${previewSubgraph.name}-${preview.namespace}-${prNumber}`;
      const routingURL = previewSubgraph.routing_url.replaceAll(
        '${PR_NUMBER}',
        prNumber.toString(),
      );
      const command = `wgc feature-subgraph publish ${featureSubgraphName} --subgraph ${previewSubgraph.name} --routing-url ${routingURL} --schema ${subgraphConfig.schema_path} -n ${preview.namespace}`;
      await exec.exec(command);
      featureSubgraphNames.push(featureSubgraphName);
      featureSubgraphsToDeploy.push({
        previewName: preview.name,
        namespace: preview.namespace,
        featureSubgraphName,
        schemaPath: subgraphConfig.schema_path,
        routingUrl: routingURL,
        baseSubgraphName: previewSubgraph.name,
      });
    }

    allFeatureSubgraphNames.push(...featureSubgraphNames);

    if (featureSubgraphNames.length === 0) {
      continue;
    }

    // Check if feature flag exists to decide create vs update
    const featureFlagName = `${preview.name}-${prNumber}`;
    let commandName = 'update';
    const listCommand = `wgc feature-flag list -n ${preview.namespace} --json`;
    let listOutput = '';
    const listOptions = {
      listeners: {
        stdout: (data: Buffer) => {
          listOutput += data.toString();
        },
      },
    };
    await exec.exec(listCommand, [], listOptions);

    if (listOutput) {
      const jsonOutput = JSON.parse(listOutput);
      const featureFlagExists = jsonOutput.find(
        (flag: { name: string }) => flag.name === featureFlagName,
      );
      if (!featureFlagExists) {
        commandName = 'create';
      }
    }

    const command = `wgc feature-flag ${commandName} ${featureFlagName} -n ${preview.namespace} --label ${preview.labels.join(' ')} --feature-subgraphs ${featureSubgraphNames.join(' ')} --json`;

    let output = '';
    let error = '';
    const options = {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
        stderr: (data: Buffer) => {
          error += data.toString();
        },
      },
    };

    await exec.exec(command, [], options);

    if (error) {
      const errorJsonOutput: SubgraphCommandJsonOutput = JSON.parse(error);
      featureFlagErrorOutputs[featureFlagName] = errorJsonOutput;
      continue;
    }
    if (output) {
      const jsonOutput: SubgraphCommandJsonOutput = JSON.parse(output);
      if (jsonOutput.status === 'success') {
        deployedFeatureFlags.push(featureFlagName);
      } else {
        featureFlagErrorOutputs[featureFlagName] = jsonOutput;
      }
    }
  }

  core.setOutput('feature_subgraphs_to_deploy', featureSubgraphsToDeploy);
  core.setOutput('feature_subgraphs_to_destroy', featureSubgraphsToDestroy);

  if (allFeatureSubgraphNames.length === 0) {
    core.info('No changes found in subgraphs to update feature subgraphs.');
    return;
  }

  await addComment({
    githubToken: inputs.githubToken,
    prNumber,
    deployedFeatureFlags,
    featureSubgraphs: allFeatureSubgraphNames,
    featureFlagErrorOutputs,
    context,
    organizationSlug,
    previews: inputs.previews,
  });
};

export const previewDelete = async ({
  inputs,
  prNumber,
  changedGraphQLFiles,
}: {
  inputs: Inputs;
  prNumber: number;
  changedGraphQLFiles: string[];
}): Promise<void> => {
  const featureSubgraphsToDestroy: FeatureSubgraphsOutputConfig[] = [];

  for (const preview of inputs.previews) {
    // Delete the feature flag for this preview
    const featureFlagName = `${preview.name}-${prNumber}`;
    const command = `wgc feature-flag delete ${featureFlagName} -n ${preview.namespace} -f`;
    await exec.exec(command);

    // Delete feature subgraphs for this preview
    for (const previewSubgraph of preview.subgraphs) {
      const subgraphConfig = inputs.subgraphs.find((s) => s.name === previewSubgraph.name);
      if (!subgraphConfig) {
        continue;
      }

      const isChanged = changedGraphQLFiles.some(
        (f) => resolve(process.cwd(), f) === subgraphConfig.schema_path,
      );
      if (!isChanged) {
        continue;
      }

      const featureSubgraphName = `${previewSubgraph.name}-${preview.namespace}-${prNumber}`;
      const routingURL = previewSubgraph.routing_url.replaceAll(
        '${PR_NUMBER}',
        prNumber.toString(),
      );
      const deleteCommand = `wgc subgraph delete ${featureSubgraphName} -n ${preview.namespace} -f`;
      await exec.exec(deleteCommand);
      featureSubgraphsToDestroy.push({
        previewName: preview.name,
        namespace: preview.namespace,
        featureSubgraphName,
        schemaPath: subgraphConfig.schema_path,
        routingUrl: routingURL,
        baseSubgraphName: previewSubgraph.name,
      });
    }
  }

  core.setOutput('feature_subgraphs_to_destroy', featureSubgraphsToDestroy);
};
