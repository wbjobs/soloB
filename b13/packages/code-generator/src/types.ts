import { PageSchema, DataModel, WorkflowDefinition } from '@lowcode/shared';

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GeneratorContext {
  projectName: string;
  pages: PageSchema[];
  dataModels: DataModel[];
  workflows: WorkflowDefinition[];
  baseApiUrl?: string;
}

export interface RendererOptions {
  appName: string;
}
