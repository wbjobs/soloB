export interface Organization {
  id: string;
  name: string;
  parentId?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Role {
  id: string;
  name: string;
  organizationId: string;
  description?: string;
  permissions: Permission[];
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  organizationId: string;
  roleIds: string[];
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Permission {
  id: string;
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'execute';
  scope?: 'all' | 'own' | 'organization';
}

export interface PagePermission {
  pageId: string;
  roleId: string;
  canView: boolean;
  canEdit: boolean;
}

export interface ButtonPermission {
  pageId: string;
  buttonId: string;
  roleId: string;
  enabled: boolean;
}

export interface DataRowPermission {
  dataModelId: string;
  roleId: string;
  condition: string;
}
