export type Config = {
  namespace: string;
  feature_flags: FeatureFlag[];
  subgraphs: {
    name: string;
    schema_path: string;
    routing_url: string;
  }[];
};

export type FeatureFlag = {
  name: string;
  labels: string[];
};

export type Subgraph = {
  name: string;
  schemaPath: string;
  routingUrl: string;
};

export type ActionType = 'create' | 'update' | 'destroy';

export type Inputs = {
  cosmoApiKey: string;
  githubToken: string;
  actionType: ActionType;
  namespace: string;
  featureFlags: FeatureFlag[];
  subgraphs: Subgraph[];
  configPath: string;
};

export type FeatureSubgraphsOutputConfig = {
  featureSubgraphName: string;
  schemaPath: string;
  routingUrl: string;
  baseSubgraphName: string;
};
