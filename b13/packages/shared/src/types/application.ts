export interface Application {
  id: string;
  name: string;
  description?: string;
  organizationId: string;
  createdBy: string;
  currentVersionId?: string;
  status: 'draft' | 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplicationVersion {
  id: string;
  applicationId: string;
  version: string;
  description?: string;
  pageSchemas: PageSchema[];
  dataModels: DataModel[];
  workflowDefinitions: WorkflowDefinition[];
  createdAt: Date;
}

export interface Environment {
  id: string;
  name: string;
  type: 'dev' | 'staging' | 'prod';
  applicationId: string;
  currentVersionId?: string;
  configuration: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Deployment {
  id: string;
  environmentId: string;
  versionId: string;
  status: 'pending' | 'deploying' | 'success' | 'failed';
  deployedBy: string;
  deployedAt?: Date;
  errorMessage?: string;
  kubernetesNamespace?: string;
}
