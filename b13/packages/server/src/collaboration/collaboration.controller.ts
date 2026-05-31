import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CollaborationService } from './collaboration.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ResourceType } from '@lowcode/shared';

@ApiTags('Collaboration')
@ApiBearerAuth()
@Controller('api/collaboration')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CollaborationController {
  constructor(private readonly collaborationService: CollaborationService) {}

  @Get('session')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Get collaboration session' })
  async getSession(
    @Req() req: any,
    @Query('resourceId') resourceId: string,
    @Query('resourceType') resourceType: ResourceType,
  ) {
    return this.collaborationService.getSession(resourceId, resourceType, req.user.organizationId);
  }

  @Get('sessions')
  @Roles('admin')
  @ApiOperation({ summary: 'List active sessions' })
  async getActiveSessions(@Req() req: any) {
    return this.collaborationService.getActiveSessions(req.user.organizationId);
  }

  @Get('session/:sessionId/history')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Get session operation history' })
  async getSessionHistory(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ) {
    return this.collaborationService.getSessionHistory(sessionId, limit ? parseInt(limit) : 500);
  }

  @Get('session/:sessionId/participants')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Get participant count' })
  async getParticipantCount(@Param('sessionId') sessionId: string) {
    const count = await this.collaborationService.getParticipantCount(sessionId);
    return { count };
  }

  @Delete('session/:sessionId')
  @Roles('admin')
  @ApiOperation({ summary: 'End collaboration session' })
  async endSession(@Param('sessionId') sessionId: string) {
    await this.collaborationService.endSession(sessionId);
    return { success: true };
  }
}
