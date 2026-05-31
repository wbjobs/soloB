import { v4 as uuidv4 } from 'uuid';

export function generateId(): string {
  return uuidv4();
}

export function toPascalCase(str: string): string {
  return str
    .replace(/^[^a-zA-Z]+/, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

export function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toSnakeCase(str: string): string {
  return str
    .replace(/^[^a-zA-Z]+/, '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase();
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function now(): Date {
  return new Date();
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function generateVersion(): string {
  const major = 1;
  const minor = Math.floor(Math.random() * 100);
  const patch = Math.floor(Math.random() * 100);
  return `${major}.${minor}.${patch}`;
}
