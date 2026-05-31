import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WorkflowService } from './workflow.service';
import { Roles } from '../auth/roles.decorator';

@ApiTags('workflows')
@Controller('applications/:applicationId/workflows')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Get()
  @ApiOperation({ summary: 'Get all workflow definitions' })
  findAll(@Param('applicationId') applicationId: string) {
    return this.workflowService.findAllDefinitions(applicationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get workflow definition by id' })
  findOne(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
  ) {
    return this.workflowService.findOneDefinition(id, applicationId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create new workflow definition' })
  create(
    @Param('applicationId') applicationId: string,
    @Body() body: any,
  ) {
    return this.workflowService.createDefinition(applicationId, body);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update workflow definition' })
  update(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.workflowService.updateDefinition(id, applicationId, body);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete workflow definition' })
  remove(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
  ) {
    return this.workflowService.removeDefinition(id, applicationId);
  }

  @Post(':id/instances')
  @ApiOperation({ summary: 'Start workflow instance' })
  startInstance(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
    @Body() body: { variables?: Record<string, any> },
    @Request() req,
  ) {
    return this.workflowService.startInstance(id, applicationId, req.user.sub, body.variables || {});
  }

  @Get(':id/instances')
  @ApiOperation({ summary: 'Get all instances for workflow' })
  getInstances(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
  ) {
    return this.workflowService.getInstances(id);
  }
}

@ApiTags('workflow-tasks')
@Controller('workflow-tasks')
export class WorkflowTaskController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Get('my')
  @ApiOperation({ summary: 'Get my tasks' })
  getMyTasks(@Request() req) {
    return this.workflowService.getTasks(req.user.sub);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Complete task' })
  completeTask(
    @Param('id') id: string,
    @Body() body: { data: Record<string, any> },
    @Request() req,
  ) {
    return this.workflowService.completeTask(id, req.user.sub, body.data || {});
  }
}
