export type FieldType =
  | 'string'
  | 'text'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'uuid'
  | 'json'
  | 'enum';

export interface DataModelField {
  id: string;
  name: string;
  type: FieldType;
  label?: string;
  required: boolean;
  unique: boolean;
  default?: string;
  enumValues?: string[];
  relationId?: string;
  description?: string;
}

export type RelationType = 'one-to-one' | 'one-to-many' | 'many-to-many';

export interface DataModelRelation {
  id: string;
  name: string;
  type: RelationType;
  fromModelId: string;
  fromFieldId?: string;
  toModelId: string;
  toFieldId?: string;
}

export interface DataModelIndex {
  id: string;
  name: string;
  fieldIds: string[];
  unique: boolean;
  type: 'btree' | 'hash' | 'gin';
}

export interface DataModel {
  id: string;
  applicationId: string;
  name: string;
  tableName: string;
  description?: string;
  fields: DataModelField[];
  relations: DataModelRelation[];
  indexes: DataModelIndex[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GeneratedEntity {
  modelId: string;
  fileName: string;
  content: string;
}

export interface GeneratedPrismaSchema {
  content: string;
}
