export interface Config {
  namespace: string;
  feature_flags: FeatureFlag[];
  subgraphs: {
    name: string;
    schema_path: string;
    routing_url: string;
  }[];
}

export interface FeatureFlag {
  name: string;
  labels: string[];
}

export interface Subgraph {
  name: string;
  schemaPath: string;
  routingUrl: string;
}

export type ActionType = 'create' | 'update' | 'destroy';

export interface Inputs {
  cosmoApiKey: string;
  githubToken: string;
  actionType: ActionType;
  namespace: string;
  featureFlags: FeatureFlag[];
  subgraphs: Subgraph[];
  configPath: string;
}

export interface FeatureSubgraphsOutputConfig {
  featureSubgraphName: string;
  schemaPath: string;
  routingUrl: string;
  baseSubgraphName: string;
}
