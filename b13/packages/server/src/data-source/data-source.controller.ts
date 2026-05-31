import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DataSourceService } from './data-source.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { DataSourceType, DataSourceConfig } from '@lowcode/shared';

@ApiTags('Data Sources')
@ApiBearerAuth()
@Controller('api/data-sources')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DataSourceController {
  constructor(private readonly dataSourceService: DataSourceService) {}

  @Get()
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'List data sources' })
  async list(
    @Req() req: any,
    @Query('applicationId') applicationId?: string,
  ) {
    return this.dataSourceService.list(req.user.organizationId, applicationId);
  }

  @Get(':id')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Get data source by ID' })
  async get(@Param('id') id: string, @Req() req: any) {
    return this.dataSourceService.get(id, req.user.organizationId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create data source' })
  async create(
    @Req() req: any,
    @Body()
    data: {
      name: string;
      displayName: string;
      type: DataSourceType;
      configuration: DataSourceConfig;
      applicationId?: string;
      isDefault?: boolean;
    },
  ) {
    return this.dataSourceService.create(req.user.organizationId, req.user.userId, data);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update data source' })
  async update(
    @Param('id') id: string,
    @Req() req: any,
    @Body()
    data: {
      displayName?: string;
      configuration?: DataSourceConfig;
      isDefault?: boolean;
      status?: 'active' | 'inactive' | 'error';
    },
  ) {
    return this.dataSourceService.update(id, req.user.organizationId, data);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete data source' })
  async delete(@Param('id') id: string, @Req() req: any) {
    await this.dataSourceService.delete(id, req.user.organizationId);
    return { success: true };
  }

  @Post(':id/test')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Test data source connection' })
  async testConnection(@Param('id') id: string, @Req() req: any) {
    return this.dataSourceService.testConnection(id, req.user.organizationId);
  }

  @Get(':id/tables')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'List tables/collections in data source' })
  async listTables(@Param('id') id: string, @Req() req: any) {
    return this.dataSourceService.listTables(id, req.user.organizationId);
  }

  @Get('/type-mappings')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Get type mappings between data sources' })
  async getTypeMappings() {
    return this.dataSourceService.getTypeMappings();
  }
}
