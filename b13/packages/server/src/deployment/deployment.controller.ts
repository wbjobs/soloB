import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DeploymentService } from './deployment.service';
import { Roles } from '../auth/roles.decorator';

@ApiTags('environments')
@Controller('applications/:applicationId/environments')
export class EnvironmentController {
  constructor(private readonly deploymentService: DeploymentService) {}

  @Get()
  @ApiOperation({ summary: 'Get all environments for application' })
  getEnvironments(
    @Param('applicationId') applicationId: string,
    @Request() req,
  ) {
    return this.deploymentService.getEnvironments(applicationId, req.user.organizationId);
  }
}

@ApiTags('deployments')
@Controller('environments/:environmentId/deployments')
export class DeploymentController {
  constructor(private readonly deploymentService: DeploymentService) {}

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Deploy version to environment' })
  deploy(
    @Param('environmentId') environmentId: string,
    @Body() body: { versionId: string },
    @Request() req,
  ) {
    return this.deploymentService.deploy(
      environmentId,
      body.versionId,
      req.user.sub,
      req.user.organizationId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get deployment history' })
  getHistory(
    @Param('environmentId') environmentId: string,
    @Request() req,
  ) {
    return this.deploymentService.getDeploymentHistory(environmentId, req.user.organizationId);
  }

  @Post(':deploymentId/rollback')
  @Roles('admin')
  @ApiOperation({ summary: 'Rollback to previous deployment' })
  rollback(
    @Param('deploymentId') deploymentId: string,
    @Request() req,
  ) {
    return this.deploymentService.rollback(deploymentId, req.user.organizationId);
  }
}
