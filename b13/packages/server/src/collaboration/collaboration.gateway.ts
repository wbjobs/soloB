import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CollaborativeSession,
  CollaborativeParticipant,
  CollaborativeOperation,
  CollaborationMessage,
  OperationType,
  ResourceType,
  generateId,
  now,
} from '@lowcode/shared';

const PARTICIPANT_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
];

@Injectable()
@WebSocketGateway({
  namespace: 'collaboration',
  cors: { origin: '*' },
})
export class CollaborationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(CollaborationGateway.name);

  private activeSessions: Map<string, Set<string>> = new Map();
  private userToSessions: Map<string, Set<string>> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.logger.log('Collaboration Gateway initialized');
  }

  afterInit(server: Server) {
    this.logger.log('WebSocket server initialized');
  }

  async handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    if (!userId) {
      this.logger.warn('Client connected without userId');
      client.disconnect();
      return;
    }

    this.logger.log(`Client connected: ${userId}`);
    client.data.userId = userId;

    if (!this.userToSessions.has(userId)) {
      this.userToSessions.set(userId, new Set());
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (!userId) return;

    this.logger.log(`Client disconnected: ${userId}`);

    const sessions = this.userToSessions.get(userId) || new Set();
    for (const sessionId of sessions) {
      await this.leaveSession(client, sessionId);
    }

    this.userToSessions.delete(userId);
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { resourceId: string; resourceType: ResourceType; organizationId: string },
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    const { resourceId, resourceType, organizationId } = data;
    const sessionId = `${organizationId}-${resourceType}-${resourceId}`;

    this.logger.log(`User ${userId} joining session ${sessionId}`);

    let session = await this.prisma.collaborativeSession.findFirst({
      where: {
        resourceId,
        resourceType,
        organizationId,
      },
    });

    if (!session) {
      session = await this.prisma.collaborativeSession.create({
        data: {
          id: generateId(),
          resourceId,
          resourceType,
          organizationId,
          isActive: true,
        },
      });
    } else if (!session.isActive) {
      session = await this.prisma.collaborativeSession.update({
        where: { id: session.id },
        data: { isActive: true },
      });
    }

    const color = await this.getAvailableColor(sessionId);
    const participant = await this.prisma.collaborativeParticipant.upsert({
      where: {
        sessionId_userId: {
          sessionId: session.id,
          userId,
        },
      },
      create: {
        sessionId: session.id,
        userId,
        isOnline: true,
        color,
      },
      update: {
        isOnline: true,
        lastSeenAt: now(),
      },
    });

    client.join(sessionId);
    client.data.sessionId = sessionId;

    if (!this.activeSessions.has(sessionId)) {
      this.activeSessions.set(sessionId, new Set());
    }
    this.activeSessions.get(sessionId)!.add(userId);

    if (!this.userToSessions.has(userId)) {
      this.userToSessions.set(userId, new Set());
    }
    this.userToSessions.get(userId)!.add(sessionId);

    const participants = await this.prisma.collaborativeParticipant.findMany({
      where: { sessionId: session.id, isOnline: true },
      include: { user: { select: { id: true, username: true } } },
    });

    const message: CollaborationMessage = {
      type: 'join',
      sessionId,
      userId,
      timestamp: Date.now(),
      payload: {
        participant: {
          id: participant.id,
          userId,
          username: client.handshake.query.username || userId,
          color,
        },
        participants: participants.map(p => ({
          id: p.id,
          userId: p.userId,
          username: (p.user as any)?.username || p.userId,
          color: p.color,
          cursorX: p.cursorX,
          cursorY: p.cursorY,
          selection: p.selection,
        })),
      },
    };

    this.server.to(sessionId).emit('collaboration:message', message);

    const recentOperations = await this.prisma.collaborativeOperation.findMany({
      where: { sessionId: session.id },
      orderBy: { version: 'desc' },
      take: 100,
    });

    client.emit('collaboration:message', {
      type: 'sync',
      sessionId,
      userId,
      timestamp: Date.now(),
      payload: {
        session,
        operations: recentOperations.reverse(),
      },
    });
  }

  @SubscribeMessage('leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    await this.leaveSession(client, data.sessionId);
  }

  @SubscribeMessage('cursor')
  async handleCursor(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; x: number; y: number; elementId?: string },
  ) {
    const userId = client.data.userId;
    if (!userId || !data.sessionId) return;

    const session = await this.prisma.collaborativeSession.findFirst({
      where: { id: data.sessionId },
    });
    if (!session) return;

    await this.prisma.collaborativeParticipant.update({
      where: {
        sessionId_userId: {
          sessionId: session.id,
          userId,
        },
      },
      data: {
        cursorX: data.x,
        cursorY: data.y,
        lastSeenAt: now(),
      },
    });

    const message: CollaborationMessage = {
      type: 'cursor',
      sessionId: data.sessionId,
      userId,
      timestamp: Date.now(),
      payload: { x: data.x, y: data.y, elementId: data.elementId },
    };

    client.broadcast.to(data.sessionId).emit('collaboration:message', message);
  }

  @SubscribeMessage('selection')
  async handleSelection(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; selectedIds: string[] },
  ) {
    const userId = client.data.userId;
    if (!userId || !data.sessionId) return;

    const session = await this.prisma.collaborativeSession.findFirst({
      where: { id: data.sessionId },
    });
    if (!session) return;

    await this.prisma.collaborativeParticipant.update({
      where: {
        sessionId_userId: {
          sessionId: session.id,
          userId,
        },
      },
      data: {
        selection: data.selectedIds,
        lastSeenAt: now(),
      },
    });

    const message: CollaborationMessage = {
      type: 'selection',
      sessionId: data.sessionId,
      userId,
      timestamp: Date.now(),
      payload: { selectedIds: data.selectedIds },
    };

    client.broadcast.to(data.sessionId).emit('collaboration:message', message);
  }

  @SubscribeMessage('operation')
  async handleOperation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      sessionId: string;
      operationType: OperationType;
      data: any;
      parentId?: string;
    },
  ) {
    const userId = client.data.userId;
    if (!userId || !data.sessionId) return;

    const session = await this.prisma.collaborativeSession.findFirst({
      where: { id: data.sessionId },
    });
    if (!session) return;

    const lastOperation = await this.prisma.collaborativeOperation.findFirst({
      where: { sessionId: session.id },
      orderBy: { version: 'desc' },
    });

    const nextVersion = (lastOperation?.version || 0) + 1;

    const transformedOp = await this.transformOperation(
      session.id,
      data.operationType,
      data.data,
      data.parentId,
      lastOperation?.id,
    );

    const operation = await this.prisma.collaborativeOperation.create({
      data: {
        id: generateId(),
        sessionId: session.id,
        userId,
        operationType: data.operationType,
        data: data.data,
        version: nextVersion,
        parentId: data.parentId,
      },
    });

    await this.prisma.collaborativeSession.update({
      where: { id: session.id },
      data: { lastActivityAt: now() },
    });

    const message: CollaborationMessage = {
      type: 'operation',
      sessionId: data.sessionId,
      userId,
      timestamp: Date.now(),
      payload: {
        operation: {
          id: operation.id,
          operationType: operation.operationType,
          data: operation.data,
          version: operation.version,
          parentId: operation.parentId,
          createdAt: operation.createdAt,
        },
      },
    };

    this.server.to(data.sessionId).emit('collaboration:message', message);

    client.emit('collaboration:message', {
      type: 'ack',
      sessionId: data.sessionId,
      userId,
      timestamp: Date.now(),
      payload: { operationId: operation.id, version: nextVersion },
    });
  }

  private async transformOperation(
    sessionId: string,
    operationType: OperationType,
    data: any,
    parentId?: string,
    lastOperationId?: string,
  ): Promise<any> {
    if (!lastOperationId) {
      return { operationType, data, parentId };
    }

    const concurrentOps = await this.prisma.collaborativeOperation.findMany({
      where: {
        sessionId,
        createdAt: {
          gte: new Date(Date.now() - 5000),
        },
      },
      orderBy: { version: 'asc' },
    });

    let transformedData = { ...data };

    for (const op of concurrentOps) {
      if (op.id === lastOperationId) continue;
      transformedData = this.applyOperationalTransformation(
        operationType,
        transformedData,
        op.operationType as OperationType,
        op.data,
      );
    }

    return { operationType, data: transformedData, parentId };
  }

  private applyOperationalTransformation(
    localType: OperationType,
    localData: any,
    remoteType: OperationType,
    remoteData: any,
  ): any {
    if (localType !== remoteType) {
      return localData;
    }

    if (localType === 'component_update' && remoteType === 'component_update') {
      if (localData.componentId !== remoteData.componentId) {
        return localData;
      }

      const localProps = localData.updates?.props || {};
      const remoteProps = remoteData.updates?.props || {};

      const localKeys = new Set(Object.keys(localProps));
      const remoteKeys = new Set(Object.keys(remoteProps));

      const conflictingKeys = [...localKeys].filter(k => remoteKeys.has(k));

      if (conflictingKeys.length > 0) {
        this.logger.log(`Conflict detected for keys: ${conflictingKeys.join(', ')}`);
        return localData;
      }

      return localData;
    }

    if ((localType === 'component_add' || localType === 'component_remove') &&
        (remoteType === 'component_add' || remoteType === 'component_remove')) {
      return localData;
    }

    return localData;
  }

  private async getAvailableColor(sessionId: string): Promise<string> {
    const participants = await this.prisma.collaborativeParticipant.findMany({
      where: { sessionId, isOnline: true },
      select: { color: true },
    });

    const usedColors = new Set(participants.map(p => p.color));

    for (const color of PARTICIPANT_COLORS) {
      if (!usedColors.has(color)) {
        return color;
      }
    }

    return PARTICIPANT_COLORS[Math.floor(Math.random() * PARTICIPANT_COLORS.length)];
  }

  private async leaveSession(client: Socket, sessionId: string) {
    const userId = client.data.userId;
    if (!userId) return;

    this.logger.log(`User ${userId} leaving session ${sessionId}`);

    client.leave(sessionId);

    const session = await this.prisma.collaborativeSession.findFirst({
      where: { id: sessionId },
    });

    if (session) {
      await this.prisma.collaborativeParticipant.update({
        where: {
          sessionId_userId: {
            sessionId: session.id,
            userId,
          },
        },
        data: {
          isOnline: false,
          lastSeenAt: now(),
        },
      });

      const remainingOnline = await this.prisma.collaborativeParticipant.count({
        where: { sessionId: session.id, isOnline: true },
      });

      if (remainingOnline === 0) {
        await this.prisma.collaborativeSession.update({
          where: { id: session.id },
          data: { isActive: false },
        });
      }
    }

    if (this.activeSessions.has(sessionId)) {
      this.activeSessions.get(sessionId)!.delete(userId);
    }

    if (this.userToSessions.has(userId)) {
      this.userToSessions.get(userId)!.delete(sessionId);
    }

    const message: CollaborationMessage = {
      type: 'leave',
      sessionId,
      userId,
      timestamp: Date.now(),
    };

    this.server.to(sessionId).emit('collaboration:message', message);
  }

  async getSessionParticipants(sessionId: string): Promise<any[]> {
    return this.prisma.collaborativeParticipant.findMany({
      where: { sessionId, isOnline: true },
      include: { user: { select: { id: true, username: true } } },
    });
  }

  async getSessionOperations(sessionId: string, limit: number = 100): Promise<any[]> {
    return this.prisma.collaborativeOperation.findMany({
      where: { sessionId },
      orderBy: { version: 'desc' },
      take: limit,
    });
  }
}
