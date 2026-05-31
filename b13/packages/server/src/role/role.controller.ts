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
import { RoleService } from './role.service';
import { Roles } from '../auth/roles.decorator';

@ApiTags('roles')
@Controller('roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Get all roles in organization' })
  findAll(@Request() req) {
    return this.roleService.findAll(req.user.organizationId);
  }

  @Get(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Get role by id' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.roleService.findOne(id, req.user.organizationId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create new role' })
  create(@Body() body: any, @Request() req) {
    return this.roleService.create(req.user.organizationId, body);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update role' })
  update(@Param('id') id: string, @Body() body: any, @Request() req) {
    return this.roleService.update(id, req.user.organizationId, body);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete role' })
  remove(@Param('id') id: string, @Request() req) {
    return this.roleService.remove(id, req.user.organizationId);
  }
}
