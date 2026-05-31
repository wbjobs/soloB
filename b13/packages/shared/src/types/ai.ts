export type AICategory =
  | 'page_generation'
  | 'component_suggestion'
  | 'data_model_generation'
  | 'workflow_generation'
  | 'code_explanation'
  | 'code_generation'
  | 'general';

export interface AIPrompt {
  id: string;
  organizationId: string;
  name: string;
  category: AICategory;
  prompt: string;
  responseFormat?: string;
  isPublic: boolean;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface AIContext {
  applicationId?: string;
  pageId?: string;
  workflowId?: string;
  dataModelId?: string;
  existingComponents?: any[];
  existingFields?: any[];
}

export interface AIConversation {
  id: string;
  organizationId: string;
  userId: string;
  applicationId?: string;
  title: string;
  messages: AIMessage[];
  context: AIContext;
  createdAt: Date;
  updatedAt: Date;
}

export interface AIGeneratedContent {
  id: string;
  organizationId: string;
  userId: string;
  applicationId?: string;
  conversationId?: string;
  contentType: AICategory;
  generatedContent: any;
  sourcePrompt?: string;
  feedback?: string;
  rating?: number;
  createdAt: Date;
}

export interface AIResponse {
  success: boolean;
  content?: any;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface PageGenerationRequest {
  description: string;
  applicationId: string;
  context?: {
    existingPages?: string[];
    existingDataModels?: string[];
  };
}

export interface ComponentSuggestionRequest {
  description: string;
  pageContext: {
    components: any[];
    layout: string;
  };
}

export interface DataModelGenerationRequest {
  description: string;
  existingModels?: string[];
}

export interface WorkflowGenerationRequest {
  description: string;
  applicationId: string;
  context?: {
    existingDataModels?: string[];
    existingPages?: string[];
  };
}
