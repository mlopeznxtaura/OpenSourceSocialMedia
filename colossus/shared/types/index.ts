export type UUID = string;
export type ISO8601 = string;

export interface User {
  id: UUID;
  colossusId?: string;
  createdAt: ISO8601;
}

export interface ExternalIdentity {
  userId: UUID;
  provider: OAuthProvider;
  providerUserId: string;
}

export type OAuthProvider =
  | 'linkedin' | 'facebook' | 'instagram' | 'whatsapp'
  | 'twitter' | 'tiktok' | 'youtube' | 'spotify'
  | 'discord' | 'github' | 'google' | 'apple'
  | 'microsoft' | 'snapchat' | 'twitch' | 'reddit'
  | 'medium' | 'substack';

export interface ContentItem {
  id: UUID;
  ownerId: UUID;
  storageUrl: string;       // ipfs://, s3://, ar://
  contentHash: string;
  mimeType: string;
  miniKernelId: string;
  createdAt: ISO8601;
}

export interface FeedItem {
  id: UUID;
  sourceKernel: string;
  authorId: UUID;
  payload: Record<string, unknown>;
  createdAt: ISO8601;
  cursor: string;
}

export interface KernelManifest {
  name: string;
  version: string;
  category: string;
  dockerImage: string;
  resources: {
    cpu: string;
    memory: string;
    minReplicas: number;
    maxReplicas: number;
  };
  graphqlSchema: string;
  eventSubscriptions: string[];
  oauthScopesNeeded: string[];
  storageBackends: string[];
  uiModule: {
    webComponent: string;
    mobileComponent: string;
    defaultRoute: string;
  };
  monetization?: {
    allowedMethods: string[];
  };
}

export interface KernelCapabilities {
  kernelId: string;
  kernelName: string;
  category: string;
  version: string;
  eventSubscriptions: string[];
}

export interface Event {
  id: UUID;
  type: string;
  sourceKernel: string;
  actorId: UUID;
  payload: Record<string, unknown>;
  createdAt: ISO8601;
}

export type FeedAlgorithm = 'chronological' | 'popularity' | 'custom';

export interface FeedFilter {
  kernels?: string[];
  since?: ISO8601;
  algorithm?: FeedAlgorithm;
  customAlgorithmFn?: string;  // WASM/JS function body (sandboxed)
}
