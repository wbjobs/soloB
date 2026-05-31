import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CollaborativeSession,
  CollaborativeParticipant,
  CollaborativeOperation,
  ResourceType,
  now,
} from '@lowcode/shared';

@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getSession(resourceId: string, resourceType: ResourceType, organizationId: string) {
    const session = await this.prisma.collaborativeSession.findFirst({
      where: {
        resourceId,
        resourceType,
        organizationId,
      },
      include: {
        participants: {
          where: { isOnline: true },
          include: { user: { select: { id: true, username: true } } },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    return session;
  }

  async getActiveSessions(organizationId: string) {
    return this.prisma.collaborativeSession.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      include: {
        _count: {
          select: { participants: { where: { isOnline: true } } },
        },
      },
      orderBy: { lastActivityAt: 'desc' },
    });
  }

  async getSessionHistory(sessionId: string, limit: number = 500) {
    return this.prisma.collaborativeOperation.findMany({
      where: { sessionId },
      orderBy: { version: 'asc' },
      take: limit,
      include: { user: { select: { id: true, username: true } } },
    });
  }

  async endSession(sessionId: string) {
    await this.prisma.collaborativeParticipant.updateMany({
      where: { sessionId, isOnline: true },
      data: { isOnline: false, lastSeenAt: now() },
    });

    return this.prisma.collaborativeSession.update({
      where: { id: sessionId },
      data: { isActive: false, lastActivityAt: now() },
    });
  }

  async getParticipantCount(sessionId: string) {
    return this.prisma.collaborativeParticipant.count({
      where: { sessionId, isOnline: true },
    });
  }

  async replayOperations(sessionId: string, fromVersion: number = 0) {
    return this.prisma.collaborativeOperation.findMany({
      where: {
        sessionId,
        version: { gte: fromVersion },
      },
      orderBy: { version: 'asc' },
    });
  }
}
