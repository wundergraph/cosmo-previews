# Cosmo Previews

Cosmo Previews is a GitHub Action designed to facilitate thorough testing of new features in a production-like environment by creating previews for every pull request (PR). This action leverages [Graph Feature Flags](https://cosmo-docs.wundergraph.com/concepts/feature-flags) to deploy new feature subgraphs and feature flags for each PR, allowing developers to test changes in an isolated environment before merging.

When developing new features, it's essential to test them in a staging environment that closely mirrors production. By using Cosmo Previews, you can override specific subgraphs for each PR in your staging environment without needing to deploy all subgraphs. This ensures that your CI pipeline remains efficient and that every PR has its own dedicated composition for testing.

## Table of Contents

- [Usage](#usage)
  - [Prerequisites](#prerequisites)
  - [Setup](#setup)
  - [Example Workflow](#example-workflow)
- [Action Parameters](#action-parameters)
- [Jobs](#jobs)
  - [Create](#create)
  - [Update](#update)
  - [Destroy](#destroy)

## Usage

### Prerequisites

Before using the Cosmo Previews GitHub Action, ensure that the following prerequisites are met:

1. **Cosmo API Key**: You must have a valid API key from WunderGraph Cosmo, which should be stored as a secret in your GitHub repository under `COSMO_API_KEY`.
2. **Configuration File**: Create a `cosmo.yaml` file in the `.github` directory of your repository. This file should define the configuration for your subgraphs and feature flags.
3. **Subgraphs on Wundergraph Cosmo**: All subgraphs referenced in the cosmo.yaml file must be created and published on Wundergraph Cosmo. Ensure that these subgraphs are correctly configured.
4. **Subgraph Deployment**: The subgraphs that are modified in the PR must be deployed at the specified routing URLs(as mentioned in the cosmo.yaml file) in the CI environment for the preview to function correctly.
5. **GitHub Token**: The GitHub token is automatically provided by GitHub Actions, but ensure it is correctly referenced.

### Setup

To use this action in your repository:

1. Create a `.github/cosmo.yaml` file that defines the configuration for your feature subgraphs and feature flags.

```yaml
version: '0.0.1'
namespace: '<your-namespace>'
feature_flags:
  - name: '<your-feature-flag>'
    labels:
      - '<label-1>'
      - '<label-2>'

subgraphs:
  - name: '<subgraph-1-name>'
    schema_path: '<path-to-schema-1>'
    routing_url: '<routing-url-1>'

  - name: '<subgraph-2-name>'
    schema_path: '<path-to-schema-2>'
    routing_url: '<routing-url-2>'
```

- The paths to schema files should be relative to the root of your repository.
- Feature flag labels must match the federated graph for which the preview is created.
- Ensure that the subgraphs mentioned in cosmo.yaml are a part of a federated graph.

2. Add the following GitHub Action workflow to your repository.

### Example Workflow

```yaml
name: Cosmo Previews
on:
  pull_request:
    branches:
      - main
    types:
      - opened
      - reopened
      - closed
      - synchronize

jobs:
  create:
    runs-on: ubuntu-latest
    if: github.event.action == 'opened' || github.event.action == 'reopened'
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20.10.0
          cache: npm

      - name: Install wgc
        run: npm i -g wgc@latest

      - name: Create Cosmo Previews
        uses: wundergraph/cosmo-previews
        with:
          config_path: .github/cosmo.yaml
          create: true
          cosmo_api_key: ${{ secrets.COSMO_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}

  update:
    runs-on: ubuntu-latest
    if: github.event.action == 'synchronize'
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20.10.0
          cache: npm

      - name: Install wgc
        run: npm i -g wgc@latest

      - name: Update Cosmo Previews
        uses: wundergraph/cosmo-previews
        with:
          config_path: .github/cosmo.yaml
          update: true
          cosmo_api_key: ${{ secrets.COSMO_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}

  destroy:
    runs-on: ubuntu-latest
    if: github.event.action == 'closed'
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: npm

      - name: Install wgc
        run: npm i -g wgc@latest

      - name: Destroy Cosmo Previews
        uses: wundergraph/cosmo-previews
        with:
          config_path: .github/cosmo.yaml
          destroy: true
          cosmo_api_key: ${{ secrets.COSMO_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Action Parameters

- `config_path`: The path to your `cosmo.yaml` configuration file.
- `create`: Set to `true` to create the feature flag and subgraphs.
- `update`: Set to `true` to update the feature subgraphs.
- `destroy`: Set to `true` to destroy the feature flag and subgraphs.
- `cosmo_api_key`: Your Cosmo API key stored in GitHub secrets.
- `github_token`: Your GitHub token, typically `${{ secrets.GITHUB_TOKEN }}`.

## Jobs

### Create

The `create` job is triggered when a pull request is opened or reopened. It performs the following actions:

1. Checks out the repository.
2. Sets up Node.js using the version specified.
3. Installs the latest version of the `wgc` CLI tool.
4. Creates feature subgraphs for all the GraphQL files modified in the pull request, provided that their corresponding subgraph configuration is specified in the `cosmo.yaml` file.
5. Creates all the feature flags specified in the `cosmo.yaml` file.

### Update

The `update` job is triggered when a pull request is synchronized. It performs the following actions:

1. Checks out the repository.
2. Sets up Node.js with the specified version.
3. Installs the latest version of the `wgc` CLI tool.
4. Creates/ Updates the feature subgraphs for all the newly modified GraphQL files in the pull request, provided that their corresponding subgraph configuration is specified in the `cosmo.yaml` file.
5. Updates all the feature flags specified in the `cosmo.yaml` file.

### Destroy

The `destroy` job is triggered when a pull request is closed. It performs the following actions:

1. Checks out the repository.
2. Sets up Node.js using the version specified.
3. Installs the latest version of the `wgc` CLI tool.
4. Destroys all the feature flags and feature subgraphs created for the pull request.

## Limitations

1. The cosmo.yaml file should not be changed after the pull request is opened. If changes are to be made, the pull request should be closed and reopened.
