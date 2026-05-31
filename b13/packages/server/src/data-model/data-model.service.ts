import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DataModel, DataModelField, DataModelRelation, DataModelIndex, generateId, now, toSnakeCase } from '@lowcode/shared';

@Injectable()
export class DataModelService {
  constructor(private readonly prisma: PrismaService) {}

  private toDataModel(db: any): DataModel {
    return {
      id: db.id,
      applicationId: db.applicationId,
      name: db.name,
      tableName: db.tableName,
      description: db.description,
      fields: db.fieldsJson || [],
      relations: db.relationsJson || [],
      indexes: db.indexesJson || [],
      createdAt: db.createdAt,
      updatedAt: db.updatedAt,
    };
  }

  async findAll(applicationId: string) {
    const models = await this.prisma.dataModelDb.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'asc' },
    });
    return models.map(m => this.toDataModel(m));
  }

  async findOne(id: string, applicationId: string) {
    const model = await this.prisma.dataModelDb.findFirst({
      where: { id, applicationId },
    });
    if (!model) throw new NotFoundException('Data model not found');
    return this.toDataModel(model);
  }

  async create(applicationId: string, data: {
    name: string;
    tableName?: string;
    description?: string;
    fields: DataModelField[];
    relations?: DataModelRelation[];
    indexes?: DataModelIndex[];
  }) {
    const tableName = data.tableName || toSnakeCase(data.name);
    
    const existing = await this.prisma.dataModelDb.findFirst({
      where: { applicationId, tableName },
    });
    if (existing) throw new BadRequestException('Data model with this table name already exists');

    const model = await this.prisma.dataModelDb.create({
      data: {
        applicationId,
        name: data.name,
        tableName,
        description: data.description,
        fieldsJson: data.fields || [],
        relationsJson: data.relations || [],
        indexesJson: data.indexes || [],
      },
    });
    return this.toDataModel(model);
  }

  async update(id: string, applicationId: string, data: {
    name?: string;
    tableName?: string;
    description?: string;
    fields?: DataModelField[];
    relations?: DataModelRelation[];
    indexes?: DataModelIndex[];
  }) {
    const existing = await this.prisma.dataModelDb.findFirst({ where: { id, applicationId } });
    if (!existing) throw new NotFoundException('Data model not found');

    const updateData: any = {
      updatedAt: now(),
    };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.tableName !== undefined) updateData.tableName = data.tableName;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.fields !== undefined) updateData.fieldsJson = data.fields;
    if (data.relations !== undefined) updateData.relationsJson = data.relations;
    if (data.indexes !== undefined) updateData.indexesJson = data.indexes;

    const model = await this.prisma.dataModelDb.update({
      where: { id },
      data: updateData,
    });
    return this.toDataModel(model);
  }

  async remove(id: string, applicationId: string) {
    const existing = await this.prisma.dataModelDb.findFirst({ where: { id, applicationId } });
    if (!existing) throw new NotFoundException('Data model not found');
    await this.prisma.dataModelDb.delete({ where: { id } });
  }

  async addField(modelId: string, applicationId: string, field: Omit<DataModelField, 'id'>) {
    const model = await this.findOne(modelId, applicationId);
    const newField: DataModelField = {
      ...field,
      id: generateId(),
    };
    return this.update(modelId, applicationId, {
      fields: [...model.fields, newField],
    });
  }

  async removeField(modelId: string, applicationId: string, fieldId: string) {
    const model = await this.findOne(modelId, applicationId);
    return this.update(modelId, applicationId, {
      fields: model.fields.filter(f => f.id !== fieldId),
    });
  }

  async addRelation(modelId: string, applicationId: string, relation: Omit<DataModelRelation, 'id'>) {
    const model = await this.findOne(modelId, applicationId);
    const newRelation: DataModelRelation = {
      ...relation,
      id: generateId(),
    };
    return this.update(modelId, applicationId, {
      relations: [...model.relations, newRelation],
    });
  }

  async removeRelation(modelId: string, applicationId: string, relationId: string) {
    const model = await this.findOne(modelId, applicationId);
    return this.update(modelId, applicationId, {
      relations: model.relations.filter(r => r.id !== relationId),
    });
  }

  async addIndex(modelId: string, applicationId: string, index: Omit<DataModelIndex, 'id'>) {
    const model = await this.findOne(modelId, applicationId);
    const newIndex: DataModelIndex = {
      ...index,
      id: generateId(),
    };
    return this.update(modelId, applicationId, {
      indexes: [...model.indexes, newIndex],
    });
  }

  async removeIndex(modelId: string, applicationId: string, indexId: string) {
    const model = await this.findOne(modelId, applicationId);
    return this.update(modelId, applicationId, {
      indexes: model.indexes.filter(i => i.id !== indexId),
    });
  }
}
