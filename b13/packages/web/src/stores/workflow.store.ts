import { makeAutoObservable, runInAction } from 'mobx';
import { WorkflowDefinition, WorkflowNode, WorkflowEdge, generateId, deepClone } from '@lowcode/shared';

const NODE_CONFIGS: Record<string, { width: number; height: number; label: string }> = {
  start: { width: 60, height: 60, label: 'Start' },
  end: { width: 60, height: 60, label: 'End' },
  userTask: { width: 140, height: 80, label: 'User Task' },
  serviceTask: { width: 140, height: 80, label: 'Service Task' },
  exclusiveGateway: { width: 70, height: 70, label: 'Exclusive' },
  parallelGateway: { width: 70, height: 70, label: 'Parallel' },
  inclusiveGateway: { width: 70, height: 70, label: 'Inclusive' },
};

class WorkflowStore {
  currentWorkflow: WorkflowDefinition | null = null;
  selectedNodeId: string | null = null;
  selectedEdgeId: string | null = null;
  loading = false;
  draggingNode = false;

  constructor() {
    makeAutoObservable(this);
  }

  get nodes() {
    return this.currentWorkflow?.nodes || [];
  }

  get edges() {
    return this.currentWorkflow?.edges || [];
  }

  get selectedNode(): WorkflowNode | null {
    if (!this.selectedNodeId) return null;
    return this.nodes.find(n => n.id === this.selectedNodeId) || null;
  }

  get selectedEdge(): WorkflowEdge | null {
    if (!this.selectedEdgeId) return null;
    return this.edges.find(e => e.id === this.selectedEdgeId) || null;
  }

  setWorkflow(workflow: WorkflowDefinition) {
    this.currentWorkflow = deepClone(workflow);
    this.selectedNodeId = null;
    this.selectedEdgeId = null;
  }

  selectNode(id: string | null) {
    this.selectedNodeId = id;
    this.selectedEdgeId = null;
  }

  selectEdge(id: string | null) {
    this.selectedEdgeId = id;
    this.selectedNodeId = null;
  }

  addNode(type: string, x: number, y: number) {
    if (!this.currentWorkflow) return;

    const config = NODE_CONFIGS[type] || { width: 100, height: 80, label: type };
    const newNode: WorkflowNode = {
      id: generateId(),
      type: type as any,
      name: config.label,
      x,
      y,
      width: config.width,
      height: config.height,
      properties: {},
    };

    this.currentWorkflow.nodes.push(newNode);
    this.selectedNodeId = newNode.id;
  }

  removeNode(id: string) {
    if (!this.currentWorkflow) return;

    this.currentWorkflow.nodes = this.currentWorkflow.nodes.filter(n => n.id !== id);
    this.currentWorkflow.edges = this.currentWorkflow.edges.filter(
      e => e.sourceId !== id && e.targetId !== id
    );

    if (this.selectedNodeId === id) {
      this.selectedNodeId = null;
    }
  }

  updateNodePosition(id: string, x: number, y: number) {
    const node = this.nodes.find(n => n.id === id);
    if (node) {
      node.x = x;
      node.y = y;
    }
  }

  updateNodeProperties(id: string, properties: Record<string, any>) {
    const node = this.nodes.find(n => n.id === id);
    if (node) {
      node.properties = { ...node.properties, ...properties };
    }
  }

  updateNodeName(id: string, name: string) {
    const node = this.nodes.find(n => n.id === id);
    if (node) {
      node.name = name;
    }
  }

  addEdge(sourceId: string, targetId: string) {
    if (!this.currentWorkflow) return;
    if (sourceId === targetId) return;

    const exists = this.edges.some(
      e => e.sourceId === sourceId && e.targetId === targetId
    );
    if (exists) return;

    const newEdge: WorkflowEdge = {
      id: generateId(),
      sourceId,
      targetId,
      properties: {},
    };

    this.currentWorkflow.edges.push(newEdge);
    this.selectedEdgeId = newEdge.id;
  }

  removeEdge(id: string) {
    if (!this.currentWorkflow) return;

    this.currentWorkflow.edges = this.currentWorkflow.edges.filter(e => e.id !== id);
    
    if (this.selectedEdgeId === id) {
      this.selectedEdgeId = null;
    }
  }

  updateEdgeCondition(id: string, condition: string) {
    const edge = this.edges.find(e => e.id === id);
    if (edge) {
      edge.condition = condition;
    }
  }

  updateEdgeName(id: string, name: string) {
    const edge = this.edges.find(e => e.id === id);
    if (edge) {
      edge.name = name;
    }
  }

  setWorkflowName(name: string) {
    if (this.currentWorkflow) {
      this.currentWorkflow.name = name;
    }
  }
}

export const workflowStore = new WorkflowStore();
