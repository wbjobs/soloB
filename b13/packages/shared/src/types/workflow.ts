export type NodeType =
  | 'start'
  | 'end'
  | 'userTask'
  | 'serviceTask'
  | 'exclusiveGateway'
  | 'parallelGateway'
  | 'inclusiveGateway'
  | 'boundaryEvent';

export type GatewayType = 'exclusive' | 'parallel' | 'inclusive';

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties: Record<string, any>;
}

export interface WorkflowEdge {
  id: string;
  sourceId: string;
  targetId: string;
  name?: string;
  condition?: string;
  properties: Record<string, any>;
}

export interface WorkflowDefinition {
  id: string;
  applicationId: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  version: string;
  status: 'draft' | 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  status: 'running' | 'completed' | 'suspended' | 'failed';
  currentNodeIds: string[];
  variables: Record<string, any>;
  startedBy: string;
  startedAt: Date;
  endedAt?: Date;
}

export interface WorkflowTask {
  id: string;
  instanceId: string;
  nodeId: string;
  assignee?: string;
  candidates: string[];
  status: 'ready' | 'claimed' | 'completed' | 'rejected';
  dueDate?: Date;
  createdAt: Date;
  completedAt?: Date;
}
