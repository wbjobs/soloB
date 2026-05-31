import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ApplicationService } from './application.service';
import { Roles } from '../auth/roles.decorator';

@ApiTags('applications')
@Controller('applications')
export class ApplicationController {
  constructor(private readonly applicationService: ApplicationService) {}

  @Get()
  @ApiOperation({ summary: 'Get all applications' })
  findAll(@Request() req, @Query() query) {
    return this.applicationService.findAll(req.user.organizationId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get application by id' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.applicationService.findOne(id, req.user.organizationId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create new application' })
  create(@Body() body: any, @Request() req) {
    return this.applicationService.create(req.user.organizationId, req.user.sub, body);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update application' })
  update(@Param('id') id: string, @Body() body: any, @Request() req) {
    return this.applicationService.update(id, req.user.organizationId, body);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete application' })
  remove(@Param('id') id: string, @Request() req) {
    return this.applicationService.remove(id, req.user.organizationId);
  }

  @Post(':id/versions')
  @Roles('admin')
  @ApiOperation({ summary: 'Create application version snapshot' })
  createVersion(@Param('id') id: string, @Body() body: any, @Request() req) {
    return this.applicationService.createVersion(id, req.user.organizationId, body?.description);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Get all application versions' })
  getVersions(@Param('id') id: string, @Request() req) {
    return this.applicationService.getVersions(id, req.user.organizationId);
  }
}
