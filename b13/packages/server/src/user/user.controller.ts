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
import { UserService } from './user.service';
import { Roles } from '../auth/roles.decorator';

@ApiTags('users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Get all users in organization' })
  findAll(@Request() req, @Query() query) {
    return this.userService.findAll(req.user.organizationId, query);
  }

  @Get(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Get user by id' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.userService.findOne(id, req.user.organizationId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create new user' })
  create(@Body() body: any, @Request() req) {
    return this.userService.create(req.user.organizationId, body);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update user' })
  update(@Param('id') id: string, @Body() body: any, @Request() req) {
    return this.userService.update(id, req.user.organizationId, body);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete user' })
  remove(@Param('id') id: string, @Request() req) {
    return this.userService.remove(id, req.user.organizationId);
  }
}
