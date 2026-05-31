import Handlebars from 'handlebars';
import {
  PageComponent,
  DataModel,
  DataModelField,
  FieldType,
  DataModelRelation,
  DataModelIndex,
  EventHandler,
  toPascalCase,
  toCamelCase,
} from '@lowcode/shared';
import {
  prismaSchemaTemplate,
  entityTemplate,
  nestControllerTemplate,
  nestServiceTemplate,
  nestModuleTemplate,
  nextPageTemplate,
  nestAppModuleTemplate,
  nestMainTemplate,
  nextPackageJsonTemplate,
  nestPackageJsonTemplate,
  dockerfileTemplate,
  helmValuesTemplate,
  nextApiServiceTemplate,
  workflowEngineTemplate,
} from './templates';

function mapPrismaType(type: FieldType): string {
  const mapping: Record<FieldType, string> = {
    string: 'String',
    text: 'String',
    integer: 'Int',
    float: 'Float',
    boolean: 'Boolean',
    date: 'DateTime',
    datetime: 'DateTime',
    uuid: 'String',
    json: 'Json',
    enum: 'String',
  };
  return mapping[type];
}

function mapTsType(type: FieldType): string {
  const mapping: Record<FieldType, string> = {
    string: 'string',
    text: 'string',
    integer: 'number',
    float: 'number',
    boolean: 'boolean',
    date: 'Date',
    datetime: 'Date',
    uuid: 'string',
    json: 'Record<string, any>',
    enum: 'string',
  };
  return mapping[type];
}

function pluralize(str: string): string {
  if (str.endsWith('y')) return str.slice(0, -1) + 'ies';
  if (str.endsWith('s')) return str + 'es';
  return str + 's';
}

function jsonStringify(obj: any): string {
  return JSON.stringify(obj, null, 2);
}

Handlebars.registerHelper('pascalCase', (str: string) => toPascalCase(str));
Handlebars.registerHelper('camelCase', (str: string) => toCamelCase(str));
Handlebars.registerHelper('prismaType', (type: FieldType) => mapPrismaType(type));
Handlebars.registerHelper('tsType', (type: FieldType) => mapTsType(type));
Handlebars.registerHelper('pluralize', (str: string) => pluralize(str));
Handlebars.registerHelper('json', (obj: any) => jsonStringify(obj));

Handlebars.registerHelper('fieldNames', (index: DataModelIndex) => {
  return index.fieldIds.map(id => `fields.${id}`).join(', ');
});

Handlebars.registerHelper('relationField', (relation: DataModelRelation, modelName: string) => {
  const fieldName = toCamelCase(relation.name);
  const targetModel = toPascalCase(relation.targetModel || relation.name);
  switch (relation.type) {
    case 'one-to-one':
      return `${fieldName}    ${targetModel}? @relation(fields: [${fieldName}Id], references: [id])
  ${fieldName}Id String?`;
    case 'one-to-many':
      return `${fieldName}s   ${targetModel}[]`;
    case 'many-to-many':
      const joinTableName = `${toPascalCase(modelName)}${targetModel}`;
      return `${fieldName}s   ${targetModel}[] @relation("${joinTableName}Relation")`;
    default:
      return '';
  }
});

Handlebars.registerHelper('relationEntityField', (relation: DataModelRelation, currentModelName: string) => {
  const fieldName = toCamelCase(relation.name);
  const targetModel = toPascalCase(relation.targetModel || relation.name);
  const currentModel = toPascalCase(currentModelName);

  const isSelfRef = targetModel === currentModel;
  const targetRef = isSelfRef ? targetModel : targetModel;

  switch (relation.type) {
    case 'one-to-one':
      return `  ${fieldName}?: ${targetRef} | null;`;
    case 'one-to-many':
      return `  ${fieldName}s?: ${targetRef}[] | null;`;
    case 'many-to-many':
      return `  ${fieldName}s?: ${targetRef}[] | null;`;
    default:
      return '';
  }
});

function renderComponent(component: PageComponent, level: number = 0): string {
  const indent = '  '.repeat(level);
  const jsxProps = Object.entries(component.props)
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return `${key}="${value}"`;
      }
      return `${key}={${JSON.stringify(value)}}`;
    })
    .join(' ');

  const styleProps = Object.keys(component.style).length > 0
    ? ` style={${JSON.stringify(component.style)}}`
    : '';

  const childContent = component.children.length > 0
    ? `\n${component.children.map(c => renderComponent(c, level + 1)).join('\n')}\n${indent}`
    : '';

  return `${indent}<${component.type}${jsxProps ? ' ' + jsxProps : ''}${styleProps}>${childContent}</${component.type}>`;
}

function getComponentImports(components: PageComponent[]): string {
  const imports = new Set<string>();
  
  function collectImports(comps: PageComponent[]) {
    comps.forEach(comp => {
      imports.add(comp.type);
      if (comp.children.length > 0) {
        collectImports(comp.children);
      }
    });
  }
  
  collectImports(components);
  return Array.from(imports).join(', ');
}

function renderActionCode(handler: EventHandler): string {
  switch (handler.action) {
    case 'navigate':
      return `router.push('${handler.config.path || '/'}');`;
    case 'callApi':
      return `await apiService.${(handler.config.method || 'get').toLowerCase()}('${handler.config.endpoint || ''}');`;
    case 'showModal':
      return `set${toPascalCase(handler.config.modalId)}Visible(true);`;
    case 'closeModal':
      return `set${toPascalCase(handler.config.modalId)}Visible(false);`;
    case 'setState':
      return `set${toPascalCase(handler.config.stateKey)}(${JSON.stringify(handler.config.value)});`;
    case 'triggerWorkflow':
      return `await apiService.post('/workflows/${handler.config.workflowId}/instances', { variables: {} });`;
    default:
      return `console.log('${handler.event} handler executed');`;
  }
}

function generateExplicitJoinTables(models: DataModel[]): string {
  const processedRelations = new Set<string>();
  const joinTables: string[] = [];

  for (const model of models) {
    for (const relation of model.relations) {
      if (relation.type !== 'many-to-many') continue;

      const modelName = toPascalCase(model.name);
      const targetModel = toPascalCase(relation.targetModel || relation.name);

      const relationKey = [modelName, targetModel].sort().join('_');
      if (processedRelations.has(relationKey)) continue;
      processedRelations.add(relationKey);

      const joinTableName = `${modelName}${targetModel}`;
      const lowerModel = toCamelCase(modelName);
      const lowerTarget = toCamelCase(targetModel);

      joinTables.push(`
model ${joinTableName} {
  ${lowerModel}Id   String
  ${lowerTarget}Id String

  ${lowerModel}   ${modelName} @relation(fields: [${lowerModel}Id], references: [id])
  ${lowerTarget}   ${targetModel} @relation(fields: [${lowerTarget}Id], references: [id])

  createdAt DateTime @default(now())

  @@id([${lowerModel}Id, ${lowerTarget}Id])
  @@unique([${lowerModel}Id, ${lowerTarget}Id])
}
`);
    }
  }

  return joinTables.join('\n');
}

export function renderPrismaSchema(models: DataModel[]): string {
  const template = Handlebars.compile(prismaSchemaTemplate);
  const explicitJoinTables = generateExplicitJoinTables(models);
  return template({ models, explicitJoinTables });
}

function buildRelationArrays(model: DataModel) {
  const oneToManyRelations = model.relations.filter(r => r.type === 'one-to-many');
  const manyToManyRelations = model.relations.filter(r => r.type === 'many-to-many');
  const oneToOneRelations = model.relations.filter(r => r.type === 'one-to-one');

  const allRelationTargets = new Set<string>();
  model.relations.forEach(r => {
    const targetModel = toPascalCase(r.targetModel || r.name);
    allRelationTargets.add(targetModel);
  });

  const selfReferencing = model.relations.some(r => {
    const targetModel = toPascalCase(r.targetModel || r.name);
    return targetModel === toPascalCase(model.name);
  });

  return {
    oneToManyRelations,
    manyToManyRelations,
    oneToOneRelations,
    allRelationTargets: Array.from(allRelationTargets),
    selfReferencing,
  };
}

export function renderEntity(model: DataModel, allModelNames: string[] = []): string {
  const template = Handlebars.compile(entityTemplate);
  const relationArrays = buildRelationArrays(model);
  return template({
    model: {
      ...model,
      ...relationArrays,
    },
  });
}

export function renderController(model: DataModel): string {
  const template = Handlebars.compile(nestControllerTemplate);
  return template({ model });
}

export function renderService(model: DataModel): string {
  const template = Handlebars.compile(nestServiceTemplate);
  return template({ model });
}

export function renderModule(model: DataModel): string {
  const template = Handlebars.compile(nestModuleTemplate);
  return template({ model });
}

export function renderAppModule(modelNames: string[]): string {
  const template = Handlebars.compile(nestAppModuleTemplate);
  return template({ modules: modelNames });
}

export function renderMain(appName: string): string {
  const template = Handlebars.compile(nestMainTemplate);
  return template({ appName });
}

export function renderNextPage(page: any): string {
  const componentImports = getComponentImports(page.components);
  const template = Handlebars.compile(nextPageTemplate);
  
  Handlebars.registerHelper('renderComponents', (components: PageComponent[]) => {
    return new Handlebars.SafeString(
      components.map(c => renderComponent(c, 2)).join('\n')
    );
  });

  Handlebars.registerHelper('actionCode', (handler: EventHandler) => {
    return new Handlebars.SafeString(renderActionCode(handler));
  });

  return template({
    page,
    componentImports,
    hasOnLoad: page.onLoadHandlers && page.onLoadHandlers.length > 0,
  });
}

export function renderNextPackageJson(appName: string): string {
  const template = Handlebars.compile(nextPackageJsonTemplate);
  return template({ appName });
}

export function renderNestPackageJson(appName: string): string {
  const template = Handlebars.compile(nestPackageJsonTemplate);
  return template({ appName });
}

export function renderDockerfile(): string {
  return dockerfileTemplate;
}

export function renderHelmValues(appName: string, env: string = 'dev'): string {
  const template = Handlebars.compile(helmValuesTemplate);
  return template({ appName, env });
}

export function renderNextApiService(): string {
  return nextApiServiceTemplate;
}

export function renderWorkflowEngine(): string {
  return workflowEngineTemplate;
}
