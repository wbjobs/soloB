export type ComponentCategory = 'custom' | 'layout' | 'form' | 'display' | 'chart' | 'other';

export type PackageType = 'umd' | 'npm';

export interface CustomComponentPropsDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'function' | 'node' | 'enum';
  description?: string;
  defaultValue?: any;
  required?: boolean;
  options?: string[];
}

export interface CustomComponentEventsDefinition {
  name: string;
  description?: string;
  params?: { name: string; type: string }[];
}

export interface CustomComponentSlotsDefinition {
  name: string;
  description?: string;
}

export interface CustomComponent {
  id: string;
  organizationId: string;
  name: string;
  displayName: string;
  description?: string;
  category: ComponentCategory;
  version: string;
  packageType: PackageType;
  umdUrl?: string;
  npmPackage?: string;
  npmVersion?: string;
  propsDefinition: CustomComponentPropsDefinition[];
  eventsDefinition: CustomComponentEventsDefinition[];
  slotsDefinition: CustomComponentSlotsDefinition[];
  previewImage?: string;
  documentation?: string;
  tags: string[];
  isPublic: boolean;
  isDeprecated: boolean;
  downloads: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomComponentVersion {
  id: string;
  componentId: string;
  version: string;
  changelog?: string;
  umdUrl?: string;
  npmVersion?: string;
  isLatest: boolean;
  createdAt: Date;
}
