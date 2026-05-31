import { makeAutoObservable, runInAction } from 'mobx';
import { PageSchema, PageComponent, generateId, deepClone } from '@lowcode/shared';

const MAX_HISTORY = 50;

class CanvasStore {
  currentPage: PageSchema | null = null;
  history: any[] = [];
  historyIndex = -1;
  selectedComponentId: string | null = null;
  draggedType: string | null = null;
  loading = false;
  saving = false;

  constructor() {
    makeAutoObservable(this);
  }

  get selectedComponent(): PageComponent | null {
    if (!this.selectedComponentId || !this.currentPage) return null;
    return this.findComponent(this.currentPage.components, this.selectedComponentId);
  }

  private findComponent(components: PageComponent[], id: string): PageComponent | null {
    for (const comp of components) {
      if (comp.id === id) return comp;
      if (comp.children?.length > 0) {
        const found = this.findComponent(comp.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  private findParentComponent(components: PageComponent[], id: string, parent: PageComponent | null = null): PageComponent | null {
    for (const comp of components) {
      if (comp.id === id) return parent;
      if (comp.children?.length > 0) {
        const found = this.findParentComponent(comp.children, id, comp);
        if (found !== undefined) return found;
      }
    }
    return null;
  }

  private isDescendantOf(components: PageComponent[], ancestorId: string, descendantId: string): boolean {
    const ancestor = this.findComponent(components, ancestorId);
    if (!ancestor) return false;

    const checkChildren = (children: PageComponent[]): boolean => {
      for (const child of children) {
        if (child.id === descendantId) return true;
        if (child.children?.length > 0 && checkChildren(child.children)) return true;
      }
      return false;
    };

    return checkChildren(ancestor.children);
  }

  private findComponentWithParent(
    components: PageComponent[],
    id: string
  ): { component: PageComponent | null; parent: PageComponent | null; index: number; container: PageComponent[] | null } {
    const index = components.findIndex(c => c.id === id);
    if (index !== -1) {
      return { component: components[index], parent: null, index, container: components };
    }
    for (const comp of components) {
      if (comp.children?.length > 0) {
        const result = this.findComponentWithParent(comp.children, id);
        if (result.component) {
          return { ...result, parent: result.parent || comp };
        }
      }
    }
    return { component: null, parent: null, index: -1, container: null };
  }

  setPage(page: PageSchema) {
    this.currentPage = deepClone(page);
    this.history = [{ components: deepClone(page.components) }];
    this.historyIndex = 0;
    this.selectedComponentId = null;
  }

  private saveToHistory() {
    if (!this.currentPage) return;
    
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    this.history.push({ components: deepClone(this.currentPage.components) });
    
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    } else {
      this.historyIndex++;
    }
  }

  undo() {
    if (this.historyIndex > 0 && this.currentPage) {
      this.historyIndex--;
      this.currentPage.components = deepClone(this.history[this.historyIndex].components);
      this.selectedComponentId = null;
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1 && this.currentPage) {
      this.historyIndex++;
      this.currentPage.components = deepClone(this.history[this.historyIndex].components);
      this.selectedComponentId = null;
    }
  }

  get canUndo() {
    return this.historyIndex > 0;
  }

  get canRedo() {
    return this.historyIndex < this.history.length - 1;
  }

  selectComponent(id: string | null) {
    this.selectedComponentId = id;
  }

  setDraggedType(type: string | null) {
    this.draggedType = type;
  }

  addComponent(type: string, parentId?: string) {
    if (!this.currentPage) return;

    const newComponent: PageComponent = {
      id: generateId(),
      type: type as any,
      parentId,
      children: [],
      props: {},
      style: {},
      events: [],
    };

    if (parentId) {
      const parent = this.findComponent(this.currentPage.components, parentId);
      if (parent) {
        parent.children.push(newComponent);
      }
    } else {
      this.currentPage.components.push(newComponent);
    }

    this.saveToHistory();
    this.selectedComponentId = newComponent.id;
  }

  removeComponent(id: string) {
    if (!this.currentPage) return;

    const removeFromTree = (components: PageComponent[]): boolean => {
      const index = components.findIndex(c => c.id === id);
      if (index !== -1) {
        components.splice(index, 1);
        return true;
      }
      for (const comp of components) {
        if (removeFromTree(comp.children)) return true;
      }
      return false;
    };

    removeFromTree(this.currentPage.components);
    this.saveToHistory();
    
    if (this.selectedComponentId === id) {
      this.selectedComponentId = null;
    }
  }

  updateComponent(id: string, updates: Partial<PageComponent>) {
    if (!this.currentPage) return;

    const component = this.findComponent(this.currentPage.components, id);
    if (component) {
      Object.assign(component, updates);
      this.saveToHistory();
    }
  }

  updateComponentProps(id: string, props: Record<string, any>) {
    if (!this.currentPage) return;

    const component = this.findComponent(this.currentPage.components, id);
    if (component) {
      component.props = { ...component.props, ...props };
      this.saveToHistory();
    }
  }

  updateComponentStyle(id: string, style: Record<string, any>) {
    if (!this.currentPage) return;

    const component = this.findComponent(this.currentPage.components, id);
    if (component) {
      component.style = { ...component.style, ...style };
      this.saveToHistory();
    }
  }

  moveComponent(componentId: string, newParentId: string | null, index: number = 0) {
    if (!this.currentPage) return;

    if (componentId === newParentId) return;

    if (newParentId && this.isDescendantOf(this.currentPage.components, componentId, newParentId)) {
      return;
    }

    const { component, container, index: oldIndex } = this.findComponentWithParent(
      this.currentPage.components,
      componentId
    );
    if (!component || !container) return;

    container.splice(oldIndex, 1);

    let targetContainer: PageComponent[];
    if (newParentId) {
      const newParent = this.findComponent(this.currentPage.components, newParentId);
      if (!newParent) {
        container.splice(oldIndex, 0, component);
        return;
      }
      targetContainer = newParent.children;
      component.parentId = newParentId;
    } else {
      targetContainer = this.currentPage.components;
      component.parentId = undefined;
    }

    const safeIndex = Math.min(Math.max(0, index), targetContainer.length);
    targetContainer.splice(safeIndex, 0, component);

    this.saveToHistory();
  }
}

export const canvasStore = new CanvasStore();
