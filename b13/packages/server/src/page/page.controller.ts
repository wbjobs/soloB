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
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { PageService } from './page.service';
import { Roles } from '../auth/roles.decorator';

@ApiTags('pages')
@Controller('applications/:applicationId/pages')
export class PageController {
  constructor(private readonly pageService: PageService) {}

  @Get()
  @ApiOperation({ summary: 'Get all pages for application' })
  findAll(@Param('applicationId') applicationId: string) {
    return this.pageService.findAll(applicationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get page by id' })
  findOne(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
  ) {
    return this.pageService.findOne(id, applicationId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create new page' })
  create(
    @Param('applicationId') applicationId: string,
    @Body() body: any,
  ) {
    return this.pageService.create(applicationId, body);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update page (including components)' })
  update(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.pageService.update(id, applicationId, body);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete page' })
  remove(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
  ) {
    return this.pageService.remove(id, applicationId);
  }

  @Post(':id/permissions')
  @Roles('admin')
  @ApiOperation({ summary: 'Set page permissions for roles' })
  setPermissions(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
    @Body() body: { permissions: any[] },
  ) {
    return this.pageService.setPermissions(id, applicationId, body.permissions);
  }
}
