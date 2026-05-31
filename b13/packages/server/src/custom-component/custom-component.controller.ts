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
import { CustomComponentService } from './custom-component.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ComponentCategory, PackageType } from '@lowcode/shared';

@ApiTags('Custom Components')
@ApiBearerAuth()
@Controller('api/custom-components')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomComponentController {
  constructor(private readonly customComponentService: CustomComponentService) {}

  @Get()
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'List custom components' })
  async list(
    @Req() req: any,
    @Query('category') category?: ComponentCategory,
    @Query('search') search?: string,
    @Query('isPublic') isPublic?: string,
    @Query('isDeprecated') isDeprecated?: string,
  ) {
    return this.customComponentService.list(req.user.organizationId, {
      category,
      search,
      isPublic: isPublic === 'true',
      isDeprecated: isDeprecated === 'true',
    });
  }

  @Get(':id')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Get custom component by ID' })
  async get(@Param('id') id: string, @Req() req: any) {
    return this.customComponentService.get(id, req.user.organizationId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create custom component' })
  async create(
    @Req() req: any,
    @Body()
    data: {
      name: string;
      displayName: string;
      description?: string;
      category?: ComponentCategory;
      version?: string;
      packageType: PackageType;
      umdUrl?: string;
      npmPackage?: string;
      npmVersion?: string;
      propsDefinition?: any[];
      eventsDefinition?: any[];
      slotsDefinition?: any[];
      previewImage?: string;
      documentation?: string;
      tags?: string[];
      isPublic?: boolean;
    },
  ) {
    return this.customComponentService.create(req.user.organizationId, req.user.userId, data);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update custom component' })
  async update(
    @Param('id') id: string,
    @Req() req: any,
    @Body()
    data: {
      displayName?: string;
      description?: string;
      category?: ComponentCategory;
      isPublic?: boolean;
      isDeprecated?: boolean;
      propsDefinition?: any[];
      eventsDefinition?: any[];
      slotsDefinition?: any[];
      previewImage?: string;
      documentation?: string;
      tags?: string[];
    },
  ) {
    return this.customComponentService.update(id, req.user.organizationId, data);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete custom component' })
  async delete(@Param('id') id: string, @Req() req: any) {
    await this.customComponentService.delete(id, req.user.organizationId);
    return { success: true };
  }

  @Get(':id/versions')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'List component versions' })
  async listVersions(@Param('id') id: string, @Req() req: any) {
    return this.customComponentService.listVersions(id, req.user.organizationId);
  }

  @Post(':id/versions')
  @Roles('admin')
  @ApiOperation({ summary: 'Create new component version' })
  async createVersion(
    @Param('id') id: string,
    @Req() req: any,
    @Body()
    data: {
      version: string;
      changelog?: string;
      umdUrl?: string;
      npmVersion?: string;
    },
  ) {
    return this.customComponentService.createVersion(id, req.user.organizationId, data);
  }

  @Get(':id/versions/latest')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Get latest version' })
  async getLatestVersion(@Param('id') id: string, @Req() req: any) {
    return this.customComponentService.getLatestVersion(id, req.user.organizationId);
  }

  @Post(':id/download')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Increment download count' })
  async download(@Param('id') id: string, @Req() req: any) {
    await this.customComponentService.incrementDownload(id, req.user.organizationId);
    return { success: true };
  }
}
