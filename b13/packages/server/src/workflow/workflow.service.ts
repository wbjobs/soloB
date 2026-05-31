import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowDefinition, WorkflowInstance, WorkflowTask, WorkflowNode, WorkflowEdge, generateId, now } from '@lowcode/shared';

interface WorkflowToken {
  id: string;
  nodeId: string;
  parentBranchId?: string;
  branchId?: string;
  status: 'active' | 'waiting' | 'completed';
  createdAt: string;
}

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toWorkflowDefinition(db: any): WorkflowDefinition {
    return {
      id: db.id,
      applicationId: db.applicationId,
      name: db.name,
      description: db.description,
      nodes: db.nodesJson || [],
      edges: db.edgesJson || [],
      version: db.version,
      status: db.status as any,
      createdAt: db.createdAt,
      updatedAt: db.updatedAt,
    };
  }

  private getTokens(instance: any): WorkflowToken[] {
    return (instance.tokens as WorkflowToken[]) || [];
  }

  private async saveTokens(instanceId: string, tokens: WorkflowToken[]) {
    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { tokens },
    });
  }

  private async addToken(instanceId: string, nodeId: string, parentBranchId?: string): Promise<WorkflowToken> {
    const instance = await this.prisma.workflowInstance.findUnique({ where: { id: instanceId } });
    const tokens = this.getTokens(instance);
    const newToken: WorkflowToken = {
      id: generateId(),
      nodeId,
      parentBranchId,
      branchId: parentBranchId ? `${parentBranchId}-${nodeId}` : nodeId,
      status: 'active',
      createdAt: now().toISOString(),
    };
    tokens.push(newToken);
    await this.saveTokens(instanceId, tokens);
    return newToken;
  }

  private async completeToken(instanceId: string, tokenId: string) {
    const instance = await this.prisma.workflowInstance.findUnique({ where: { id: instanceId } });
    const tokens = this.getTokens(instance);
    const tokenIndex = tokens.findIndex(t => t.id === tokenId);
    if (tokenIndex !== -1) {
      tokens[tokenIndex].status = 'completed';
      await this.saveTokens(instanceId, tokens);
    }
  }

  private getBranchTokens(tokens: WorkflowToken[], branchBaseId: string): WorkflowToken[] {
    return tokens.filter(t => t.branchId?.startsWith(branchBaseId) || t.nodeId === branchBaseId);
  }

  private countActiveBranchTokens(tokens: WorkflowToken[], branchBaseId: string): number {
    return this.getBranchTokens(tokens, branchBaseId).filter(t => t.status === 'active').length;
  }

  private getAllBranchNodes(definition: WorkflowDefinition, gatewayNodeId: string): string[] {
    const outgoingEdges = definition.edges.filter(e => e.sourceId === gatewayNodeId);
    return outgoingEdges.map(e => e.targetId);
  }

  async findAllDefinitions(applicationId: string) {
    const defs = await this.prisma.workflowDefinitionDb.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
    return defs.map(d => this.toWorkflowDefinition(d));
  }

  async findOneDefinition(id: string, applicationId: string) {
    const def = await this.prisma.workflowDefinitionDb.findFirst({
      where: { id, applicationId },
    });
    if (!def) throw new NotFoundException('Workflow not found');
    return this.toWorkflowDefinition(def);
  }

  async createDefinition(applicationId: string, data: {
    name: string;
    description?: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  }) {
    const def = await this.prisma.workflowDefinitionDb.create({
      data: {
        applicationId,
        name: data.name,
        description: data.description,
        nodesJson: data.nodes || [],
        edgesJson: data.edges || [],
        version: '1.0.0',
      },
    });
    return this.toWorkflowDefinition(def);
  }

  async updateDefinition(id: string, applicationId: string, data: {
    name?: string;
    description?: string;
    nodes?: WorkflowNode[];
    edges?: WorkflowEdge[];
    status?: string;
  }) {
    const existing = await this.prisma.workflowDefinitionDb.findFirst({ where: { id, applicationId } });
    if (!existing) throw new NotFoundException('Workflow not found');

    const updateData: any = { updatedAt: now() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.nodes !== undefined) updateData.nodesJson = data.nodes;
    if (data.edges !== undefined) updateData.edgesJson = data.edges;
    if (data.status !== undefined) updateData.status = data.status;

    const def = await this.prisma.workflowDefinitionDb.update({
      where: { id },
      data: updateData,
    });
    return this.toWorkflowDefinition(def);
  }

  async removeDefinition(id: string, applicationId: string) {
    const existing = await this.prisma.workflowDefinitionDb.findFirst({ where: { id, applicationId } });
    if (!existing) throw new NotFoundException('Workflow not found');
    await this.prisma.workflowDefinitionDb.delete({ where: { id } });
  }

  async startInstance(definitionId: string, applicationId: string, startedBy: string, variables: Record<string, any> = {}) {
    const definition = await this.findOneDefinition(definitionId, applicationId);
    const startNode = definition.nodes.find(n => n.type === 'start');
    if (!startNode) throw new Error('Workflow has no start node');

    const initialToken: WorkflowToken = {
      id: generateId(),
      nodeId: startNode.id,
      branchId: startNode.id,
      status: 'active',
      createdAt: now().toISOString(),
    };

    const instance = await this.prisma.workflowInstance.create({
      data: {
        definitionId,
        startedBy,
        variables,
        currentNodes: [startNode.id],
        tokens: [initialToken],
      },
    });

    await this.executeToken(instance.id, definition, startNode.id, initialToken.id);
    return instance;
  }

  private async executeToken(instanceId: string, definition: WorkflowDefinition, nodeId: string, tokenId: string) {
    const node = definition.nodes.find(n => n.id === nodeId);
    if (!node) {
      this.logger.warn(`Node not found: ${nodeId}`);
      return;
    }

    this.logger.log(`Executing token ${tokenId} on node: ${node.type} - ${node.name}`);

    switch (node.type) {
      case 'start':
        await this.processStart(instanceId, definition, node, tokenId);
        break;
      case 'end':
        await this.processEnd(instanceId);
        break;
      case 'userTask':
        await this.processUserTask(instanceId, node);
        break;
      case 'serviceTask':
        await this.processServiceTask(instanceId, definition, node, tokenId);
        break;
      case 'exclusiveGateway':
        await this.processExclusiveGateway(instanceId, definition, node, tokenId);
        break;
      case 'parallelGateway':
        await this.processParallelGateway(instanceId, definition, node, tokenId);
        break;
      default:
        this.logger.warn(`Unknown node type: ${node.type}`);
        await this.advanceToNextNode(instanceId, definition, node.id, tokenId);
    }
  }

  private async processStart(instanceId: string, definition: WorkflowDefinition, node: WorkflowNode, tokenId: string) {
    await this.advanceToNextNode(instanceId, definition, node.id, tokenId);
  }

  private async processEnd(instanceId: string) {
    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: {
        status: 'completed',
        endedAt: now(),
        currentNodes: [],
      },
    });
    this.logger.log(`Workflow instance ${instanceId} completed`);
  }

  private async processUserTask(instanceId: string, node: WorkflowNode) {
    await this.prisma.workflowTask.create({
      data: {
        instanceId,
        nodeId: node.id,
        assignee: node.properties?.assignee,
        candidates: node.properties?.candidates || [],
        dueDate: node.properties?.dueDate ? new Date(node.properties.dueDate) : null,
      },
    });
  }

  private async processServiceTask(instanceId: string, definition: WorkflowDefinition, node: WorkflowNode, tokenId: string) {
    const serviceName = node.properties?.serviceName;
    const operation = node.properties?.operation;
    this.logger.log(`Executing service: ${serviceName}.${operation}`);
    await this.advanceToNextNode(instanceId, definition, node.id, tokenId);
  }

  private async processExclusiveGateway(instanceId: string, definition: WorkflowDefinition, node: WorkflowNode, tokenId: string) {
    const instance = await this.prisma.workflowInstance.findUnique({ where: { id: instanceId } });
    const variables = (instance?.variables as Record<string, any>) || {};

    const outgoingEdges = definition.edges.filter(e => e.sourceId === node.id);
    for (const edge of outgoingEdges) {
      if (this.evaluateCondition(edge.condition, variables)) {
        await this.completeToken(instanceId, tokenId);
        const newToken = await this.addToken(instanceId, edge.targetId);
        await this.updateCurrentNodesFromTokens(instanceId);
        await this.executeToken(instanceId, definition, edge.targetId, newToken.id);
        return;
      }
    }
  }

  private async processParallelGateway(instanceId: string, definition: WorkflowDefinition, node: WorkflowNode, tokenId: string) {
    const outgoingEdges = definition.edges.filter(e => e.sourceId === node.id);

    if (outgoingEdges.length === 0) {
      this.logger.warn('Parallel gateway has no outgoing edges');
      return;
    }

    const instance = await this.prisma.workflowInstance.findUnique({ where: { id: instanceId } });
    const tokens = this.getTokens(instance);

    const branchBaseId = node.id;
    const expectedBranches = this.getAllBranchNodes(definition, node.id);
    const activeBranchTokens = this.countActiveBranchTokens(tokens, branchBaseId);

    if (activeBranchTokens === 0) {
      this.logger.log(`Parallel gateway ${node.id} forking into ${outgoingEdges.length} branches`);
      await this.completeToken(instanceId, tokenId);

      for (const edge of outgoingEdges) {
        const newToken = await this.addToken(instanceId, edge.targetId, branchBaseId);
        await this.updateCurrentNodesFromTokens(instanceId);
        await this.executeToken(instanceId, definition, edge.targetId, newToken.id);
      }
    } else {
      this.logger.log(`Parallel gateway ${node.id} joining - active tokens: ${activeBranchTokens}, expected: ${expectedBranches.length}`);
      await this.completeToken(instanceId, tokenId);

      const refreshedInstance = await this.prisma.workflowInstance.findUnique({ where: { id: instanceId } });
      const refreshedTokens = this.getTokens(refreshedInstance);
      const remainingActive = this.countActiveBranchTokens(refreshedTokens, branchBaseId);

      if (remainingActive === 0) {
        this.logger.log(`All branches completed for parallel gateway ${node.id}, continuing flow`);
        const joinEdges = definition.edges.filter(e => e.sourceId === node.id);

        if (joinEdges.length > 0) {
          const nextNodeId = joinEdges[0].targetId;
          const newToken = await this.addToken(instanceId, nextNodeId);
          await this.updateCurrentNodesFromTokens(instanceId);
          await this.executeToken(instanceId, definition, nextNodeId, newToken.id);
        }
      } else {
        this.logger.log(`Waiting for ${remainingActive} more branches to complete`);
      }
    }
  }

  private async advanceToNextNode(instanceId: string, definition: WorkflowDefinition, currentNodeId: string, tokenId: string) {
    const outgoingEdges = definition.edges.filter(e => e.sourceId === currentNodeId);

    if (outgoingEdges.length === 0) {
      this.logger.log(`No outgoing edges from node ${currentNodeId}, completing token`);
      await this.completeToken(instanceId, tokenId);
      await this.updateCurrentNodesFromTokens(instanceId);
      return;
    }

    await this.completeToken(instanceId, tokenId);

    for (const edge of outgoingEdges) {
      const nextNode = definition.nodes.find(n => n.id === edge.targetId);
      if (nextNode) {
        const instance = await this.prisma.workflowInstance.findUnique({ where: { id: instanceId } });
        const tokens = this.getTokens(instance);
        const currentToken = tokens.find(t => t.id === tokenId);

        const newToken = await this.addToken(instanceId, edge.targetId, currentToken?.branchId);
        await this.updateCurrentNodesFromTokens(instanceId);
        await this.executeToken(instanceId, definition, edge.targetId, newToken.id);
      }
    }
  }

  private async updateCurrentNodesFromTokens(instanceId: string) {
    const instance = await this.prisma.workflowInstance.findUnique({ where: { id: instanceId } });
    const tokens = this.getTokens(instance);
    const activeNodeIds = tokens
      .filter(t => t.status === 'active')
      .map(t => t.nodeId);

    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { currentNodes: activeNodeIds },
    });
  }

  private evaluateCondition(condition: string | undefined, variables: Record<string, any>): boolean {
    if (!condition) return true;
    try {
      const fn = new Function('vars', `return ${condition};`);
      return fn(variables);
    } catch (error) {
      this.logger.error(`Condition evaluation failed: ${condition}`, error);
      return false;
    }
  }

  async getTasks(userId: string) {
    return this.prisma.workflowTask.findMany({
      where: {
        OR: [
          { assignee: userId },
          { candidates: { arrayContains: [userId] } },
        ],
        status: { in: ['ready', 'claimed'] },
      },
      include: { instance: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async completeTask(taskId: string, userId: string, data: Record<string, any>) {
    const task = await this.prisma.workflowTask.findUnique({
      where: { id: taskId },
      include: { instance: { include: { definition: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');

    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: task.instanceId },
    });

    const variables = { ...(instance?.variables as Record<string, any> || {}), ...data };
    await this.prisma.workflowInstance.update({
      where: { id: task.instanceId },
      data: { variables },
    });

    await this.prisma.workflowTask.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        completedAt: now(),
      },
    });

    const definition = this.toWorkflowDefinition(task.instance.definition);
    const currentNode = definition.nodes.find(n => n.id === task.nodeId);

    if (currentNode) {
      const tokens = this.getTokens(instance);
      const activeToken = tokens.find(t => t.nodeId === task.nodeId && t.status === 'active');

      if (activeToken) {
        const outgoingEdges = definition.edges.filter(e => e.sourceId === task.nodeId);
        await this.completeToken(task.instanceId, activeToken.id);

        for (const edge of outgoingEdges) {
          const nextNode = definition.nodes.find(n => n.id === edge.targetId);
          if (nextNode) {
            const newToken = await this.addToken(task.instanceId, edge.targetId, activeToken.branchId);
            await this.updateCurrentNodesFromTokens(task.instanceId);
            await this.executeToken(task.instanceId, definition, edge.targetId, newToken.id);
          }
        }
      }
    }

    return task;
  }

  async getInstances(definitionId: string) {
    return this.prisma.workflowInstance.findMany({
      where: { definitionId },
      include: { tasks: true },
      orderBy: { startedAt: 'desc' },
    });
  }
}
