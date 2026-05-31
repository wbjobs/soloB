import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DataModelService } from './data-model.service';
import { Roles } from '../auth/roles.decorator';

@ApiTags('data-models')
@Controller('applications/:applicationId/data-models')
export class DataModelController {
  constructor(private readonly dataModelService: DataModelService) {}

  @Get()
  @ApiOperation({ summary: 'Get all data models for application' })
  findAll(@Param('applicationId') applicationId: string) {
    return this.dataModelService.findAll(applicationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get data model by id' })
  findOne(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
  ) {
    return this.dataModelService.findOne(id, applicationId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create new data model' })
  create(
    @Param('applicationId') applicationId: string,
    @Body() body: any,
  ) {
    return this.dataModelService.create(applicationId, body);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update data model' })
  update(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.dataModelService.update(id, applicationId, body);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete data model' })
  remove(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
  ) {
    return this.dataModelService.remove(id, applicationId);
  }

  @Post(':id/fields')
  @Roles('admin')
  @ApiOperation({ summary: 'Add field to data model' })
  addField(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
    @Body() field: any,
  ) {
    return this.dataModelService.addField(id, applicationId, field);
  }

  @Delete(':id/fields/:fieldId')
  @Roles('admin')
  @ApiOperation({ summary: 'Remove field from data model' })
  removeField(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
    @Param('fieldId') fieldId: string,
  ) {
    return this.dataModelService.removeField(id, applicationId, fieldId);
  }

  @Post(':id/relations')
  @Roles('admin')
  @ApiOperation({ summary: 'Add relation to data model' })
  addRelation(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
    @Body() relation: any,
  ) {
    return this.dataModelService.addRelation(id, applicationId, relation);
  }

  @Delete(':id/relations/:relationId')
  @Roles('admin')
  @ApiOperation({ summary: 'Remove relation from data model' })
  removeRelation(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
    @Param('relationId') relationId: string,
  ) {
    return this.dataModelService.removeRelation(id, applicationId, relationId);
  }

  @Post(':id/indexes')
  @Roles('admin')
  @ApiOperation({ summary: 'Add index to data model' })
  addIndex(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
    @Body() index: any,
  ) {
    return this.dataModelService.addIndex(id, applicationId, index);
  }

  @Delete(':id/indexes/:indexId')
  @Roles('admin')
  @ApiOperation({ summary: 'Remove index from data model' })
  removeIndex(
    @Param('applicationId') applicationId: string,
    @Param('id') id: string,
    @Param('indexId') indexId: string,
  ) {
    return this.dataModelService.removeIndex(id, applicationId, indexId);
  }
}
