import { Controller, Get, Put, Body, Request, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrganizationService } from './organization.service';
import { Roles } from '../auth/roles.decorator';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Get('current')
  @ApiOperation({ summary: 'Get current organization' })
  getCurrent(@Request() req) {
    return this.organizationService.findOne(req.user.organizationId);
  }

  @Get(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Get organization by id' })
  findOne(@Param('id') id: string) {
    return this.organizationService.findOne(id);
  }

  @Get(':id/hierarchy')
  @Roles('admin')
  @ApiOperation({ summary: 'Get organization hierarchy' })
  getHierarchy(@Param('id') id: string) {
    return this.organizationService.getHierarchy(id);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update organization' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.organizationService.update(id, body);
  }
}
