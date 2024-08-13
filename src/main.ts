import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import { Inputs, getInputs } from './inputs.js';

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const context = github.context;

    const pullRequest = context.payload.pull_request;
    if (!pullRequest) {
      core.setFailed('This action only works with pull_requests.');
      return;
    }

    const prNumber = pullRequest.number;

    const inputs = getInputs();
    if (!inputs) {
      return;
    }

    setUpWgc(inputs.cosmoApiKey);

    switch (inputs.actionType) {
      case 'create': {
        await create({ inputs, prNumber });
        break;
      }
      case 'update': {
        await update({ inputs, prNumber });
        break;
      }
      case 'destroy': {
        await destroy({ inputs, prNumber });
        break;
      }
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

/**
 * Exports the API key as an environment variable.
 */
async function setUpWgc(apiKey: string): Promise<void> {
  core.info('Installing wgc@latest globally...');
  await exec.exec('npm install -g wgc@latest');

  // Adding npm global bin to PATH
  const npmGlobalBin = await exec.getExecOutput('npm bin -g');
  core.addPath(npmGlobalBin.stdout.trim());
  
  core.exportVariable('COSMO_API_KEY', apiKey);
}

const create = async ({ inputs, prNumber }: { inputs: Inputs; prNumber: number }): Promise<void> => {
  // Create the resources
  let featureSubgraphsString = '';
  for (const subgraph of inputs.subgraphs) {
    const featureSubgraphName = `${subgraph.name}-${inputs.namespace}-${prNumber}`;
    const command = `wgc feature-subgraph publish ${featureSubgraphName} --subgraph ${subgraph.name} --routing-url ${subgraph.routingUrl} --schema ${subgraph.schemaPath} -n ${inputs.namespace}`;
    await exec.exec(command);
    featureSubgraphsString += `${featureSubgraphName},`;
    core.info(`Feature subgraph ${featureSubgraphName} using ${subgraph.name} as base subgraph is created.`);
  }
  for (const featureFlag of inputs.featureFlags) {
    const command = `wgc feature-flag create ${featureFlag.name} -n ${inputs.namespace} --label ${featureFlag.labels.join(' ')} --feature-subgraphs ${featureSubgraphsString} --enabled`;
    await exec.exec(command);
    core.info(`Feature flag ${featureFlag.name} is created.`);
  }
};

const update = async ({ inputs, prNumber }: { inputs: Inputs; prNumber: number }): Promise<void> => {
  // Update the resources
  let featureSubgraphsString = '';
  for (const subgraph of inputs.subgraphs) {
    const featureSubgraphName = `${subgraph.name}-${inputs.namespace}-${prNumber}`;
    const command = `wgc feature-subgraph publish ${featureSubgraphName} --subgraph ${subgraph.name} --routing-url ${subgraph.routingUrl} --schema ${subgraph.schemaPath} -n ${inputs.namespace}`;
    await exec.exec(command);
    featureSubgraphsString += `${featureSubgraphName},`;
    core.info(`Feature subgraph ${featureSubgraphName} using ${subgraph.name} as base subgraph is updated.`);
  }
  for (const featureFlag of inputs.featureFlags) {
    const command = `wgc feature-flag update ${featureFlag.name} -n ${inputs.namespace} --label ${featureFlag.labels.join(' ')} --feature-subgraphs ${featureSubgraphsString}`;
    await exec.exec(command);
    core.info(`Feature flag ${featureFlag.name} is updated.`);
  }
};

const destroy = async ({ inputs, prNumber }: { inputs: Inputs; prNumber: number }): Promise<void> => {
  // Destroy the resources
  for (const featureFlag of inputs.featureFlags) {
    const command = `wgc feature-flag delete ${featureFlag.name} -n ${inputs.namespace} -f`;
    await exec.exec(command);
    core.info(`Feature flag ${featureFlag.name} is deleted.`);
  }
  for (const subgraph of inputs.subgraphs) {
    const featureSubgraphName = `${subgraph.name}-${inputs.namespace}-${prNumber}`;
    const command = `wgc subgraph delete ${featureSubgraphName} -n ${inputs.namespace} -f`;
    await exec.exec(command);
    core.info(`Feature subgraph ${featureSubgraphName} is deleted.`);
  }
};
