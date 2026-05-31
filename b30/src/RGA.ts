import { PositionIdentifier, RGAElement, Operation, InsertOperation, BatchInsertOperation, DeleteOperation, BatchDeleteOperation, VectorClock } from './types';

type PendingInsertOp = InsertOperation & { __dependencyId: string };
type PendingBatchInsertOp = BatchInsertOperation & { __dependencyId: string };
type PendingDeleteOp = DeleteOperation & { __dependencyId: string };
type PendingBatchDeleteOp = BatchDeleteOperation & { __dependencyId: string };
type PendingOp = PendingInsertOp | PendingBatchInsertOp | PendingDeleteOp | PendingBatchDeleteOp;

export class RGA {
  private readonly elements: Map<string, RGAElement> = new Map();
  private head: PositionIdentifier | null = null;
  private readonly siteId: string;
  private clock: number = 0;
  private vectorClock: VectorClock = {};
  private pendingOpsByDependency: Map<string, PendingOp[]> = new Map();

  constructor(siteId: string) {
    this.siteId = siteId;
    this.vectorClock = { [siteId]: 0 };
  }

  private idToString(id: PositionIdentifier): string {
    return `${id.site}:${id.clock}`;
  }

  private getNextPosition(): PositionIdentifier {
    this.clock++;
    this.vectorClock[this.siteId] = this.clock;
    return { site: this.siteId, clock: this.clock };
  }

  private cloneVectorClock(): VectorClock {
    return { ...this.vectorClock };
  }

  private updateVectorClock(opVectorClock: VectorClock): void {
    for (const site in opVectorClock) {
      this.vectorClock[site] = Math.max(this.vectorClock[site] || 0, opVectorClock[site]);
    }
  }

  private getElement(id: PositionIdentifier | null): RGAElement | null {
    if (!id) return null;
    return this.elements.get(this.idToString(id)) || null;
  }

  private hasElement(id: PositionIdentifier | null): boolean {
    if (!id) return true;
    return this.elements.has(this.idToString(id));
  }

  private addElement(element: RGAElement): void {
    this.elements.set(this.idToString(element.id), element);
  }

  private addPendingOp(dependencyId: string, op: PendingOp): void {
    if (!this.pendingOpsByDependency.has(dependencyId)) {
      this.pendingOpsByDependency.set(dependencyId, []);
    }
    this.pendingOpsByDependency.get(dependencyId)!.push(op);
  }

  private getAndClearPendingOps(dependencyId: string): PendingOp[] {
    const ops = this.pendingOpsByDependency.get(dependencyId) || [];
    this.pendingOpsByDependency.delete(dependencyId);
    return ops;
  }

  private insertElementIntoList(element: RGAElement, insertAfterId: PositionIdentifier | null): void {
    const insertAfterElement = this.getElement(insertAfterId);
    
    if (insertAfterElement) {
      let sibling = insertAfterElement.next;
      let predecessor = insertAfterElement;

      while (sibling) {
        const siblingElement = this.getElement(sibling);
        if (!siblingElement) break;

        if (this.compareIds(element.id, siblingElement.id) < 0) {
          break;
        }

        predecessor = siblingElement;
        sibling = siblingElement.next;
      }

      element.next = predecessor.next;
      predecessor.next = element.id;
    } else {
      let current = this.head;
      let predecessor: RGAElement | null = null;

      while (current) {
        const currentElement = this.getElement(current);
        if (!currentElement) break;

        if (this.compareIds(element.id, currentElement.id) < 0) {
          break;
        }

        predecessor = currentElement;
        current = currentElement.next;
      }

      if (!predecessor) {
        element.next = this.head;
        this.head = element.id;
      } else {
        element.next = predecessor.next;
        predecessor.next = element.id;
      }
    }
  }

  getVisibleText(): string {
    const visibleChars: string[] = [];
    let current = this.head;

    while (current) {
      const element = this.getElement(current);
      if (element && !element.isTombstone && element.value !== null) {
        visibleChars.push(element.value);
      }
      current = element?.next || null;
    }

    return visibleChars.join('');
  }

  getVisibleElementCount(): number {
    let count = 0;
    let current = this.head;

    while (current) {
      const element = this.getElement(current);
      if (element && !element.isTombstone && element.value !== null) {
        count++;
      }
      current = element?.next || null;
    }

    return count;
  }

  getElementAtVisiblePosition(visiblePosition: number): RGAElement | null {
    let current = this.head;
    let visibleIndex = 0;

    while (current) {
      const element = this.getElement(current);
      if (element) {
        if (!element.isTombstone && element.value !== null) {
          if (visibleIndex === visiblePosition) {
            return element;
          }
          visibleIndex++;
        }
        current = element.next;
      } else {
        break;
      }
    }

    return null;
  }

  getElementBeforeVisiblePosition(visiblePosition: number): RGAElement | null {
    if (visiblePosition === 0) {
      return null;
    }

    const element = this.getElementAtVisiblePosition(visiblePosition - 1);
    return element;
  }

  localInsert(visiblePosition: number, char: string): InsertOperation {
    const insertAfterElement = this.getElementBeforeVisiblePosition(visiblePosition);
    const insertAfterId = insertAfterElement ? insertAfterElement.id : null;
    const newElementId = this.getNextPosition();

    const newElement: RGAElement = {
      id: newElementId,
      value: char,
      next: insertAfterElement ? insertAfterElement.next : this.head,
      isTombstone: false,
    };

    if (insertAfterElement) {
      insertAfterElement.next = newElementId;
    } else {
      this.head = newElementId;
    }

    this.addElement(newElement);

    return {
      type: 'insert',
      position: visiblePosition,
      char,
      insertAfterId,
      newElementId,
      clientId: this.siteId,
      timestamp: Date.now(),
      vectorClock: this.cloneVectorClock(),
    };
  }

  localDelete(visiblePosition: number): DeleteOperation | null {
    const elementToDelete = this.getElementAtVisiblePosition(visiblePosition);

    if (!elementToDelete) {
      return null;
    }

    const deleteId = elementToDelete.id;
    elementToDelete.isTombstone = true;
    this.getNextPosition();

    return {
      type: 'delete',
      position: visiblePosition,
      elementId: deleteId,
      clientId: this.siteId,
      timestamp: Date.now(),
      vectorClock: this.cloneVectorClock(),
    };
  }

  localBatchInsert(visiblePosition: number, text: string): BatchInsertOperation | null {
    if (text.length === 0) {
      return null;
    }

    const insertAfterElement = this.getElementBeforeVisiblePosition(visiblePosition);
    const insertAfterId = insertAfterElement ? insertAfterElement.id : null;
    const newElementIds: PositionIdentifier[] = [];
    const elements: RGAElement[] = [];

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const newElementId = this.getNextPosition();
      newElementIds.push(newElementId);

      const newElement: RGAElement = {
        id: newElementId,
        value: char,
        next: null,
        isTombstone: false,
      };
      elements.push(newElement);
    }

    for (let i = 0; i < elements.length; i++) {
      if (i < elements.length - 1) {
        elements[i].next = elements[i + 1].id;
      } else {
        elements[i].next = insertAfterElement ? insertAfterElement.next : this.head;
      }
    }

    if (insertAfterElement) {
      insertAfterElement.next = elements[0].id;
    } else {
      this.head = elements[0].id;
    }

    for (const element of elements) {
      this.addElement(element);
    }

    return {
      type: 'batchInsert',
      position: visiblePosition,
      text,
      insertAfterId,
      newElementIds,
      clientId: this.siteId,
      timestamp: Date.now(),
      vectorClock: this.cloneVectorClock(),
    };
  }

  localBatchDelete(visiblePosition: number, count: number): BatchDeleteOperation | null {
    if (count <= 0) {
      return null;
    }

    const elementIds: PositionIdentifier[] = [];
    let currentElement = this.getElementAtVisiblePosition(visiblePosition);

    if (!currentElement) {
      return null;
    }

    for (let i = 0; i < count && currentElement; i++) {
      elementIds.push(currentElement.id);
      currentElement.isTombstone = true;

      let nextVisible = currentElement.next;
      while (nextVisible) {
        const nextElement = this.getElement(nextVisible);
        if (nextElement && !nextElement.isTombstone && nextElement.value !== null) {
          currentElement = nextElement;
          break;
        }
        nextVisible = nextElement?.next || null;
      }

      if (!nextVisible) {
        currentElement = null;
      }
    }

    this.getNextPosition();

    return {
      type: 'batchDelete',
      position: visiblePosition,
      count: elementIds.length,
      elementIds,
      clientId: this.siteId,
      timestamp: Date.now(),
      vectorClock: this.cloneVectorClock(),
    };
  }

  applyRemoteInsert(op: InsertOperation): void {
    const newElementIdStr = this.idToString(op.newElementId);

    if (this.elements.has(newElementIdStr)) {
      return;
    }

    if (!this.hasElement(op.insertAfterId)) {
      const dependencyId = op.insertAfterId ? this.idToString(op.insertAfterId) : 'HEAD';
      this.addPendingOp(dependencyId, { ...op, __dependencyId: dependencyId });
      return;
    }

    this.updateVectorClock(op.vectorClock);

    const newElement: RGAElement = {
      id: op.newElementId,
      value: op.char,
      next: null,
      isTombstone: false,
    };

    this.insertElementIntoList(newElement, op.insertAfterId);
    this.addElement(newElement);

    this.processPendingOps(newElementIdStr);
  }

  applyRemoteDelete(op: DeleteOperation): void {
    const elementIdStr = this.idToString(op.elementId);

    if (!this.hasElement(op.elementId)) {
      this.addPendingOp(elementIdStr, { ...op, __dependencyId: elementIdStr });
      return;
    }

    this.updateVectorClock(op.vectorClock);
    const element = this.getElement(op.elementId);
    if (element && !element.isTombstone) {
      element.isTombstone = true;
    }
  }

  applyRemoteBatchInsert(op: BatchInsertOperation): void {
    if (op.newElementIds.length === 0 || op.text.length === 0) {
      return;
    }

    const firstNewElementIdStr = this.idToString(op.newElementIds[0]);
    if (this.elements.has(firstNewElementIdStr)) {
      return;
    }

    if (!this.hasElement(op.insertAfterId)) {
      const dependencyId = op.insertAfterId ? this.idToString(op.insertAfterId) : 'HEAD';
      this.addPendingOp(dependencyId, { ...op, __dependencyId: dependencyId });
      return;
    }

    this.updateVectorClock(op.vectorClock);

    const elements: RGAElement[] = [];
    for (let i = 0; i < op.newElementIds.length; i++) {
      const element: RGAElement = {
        id: op.newElementIds[i],
        value: op.text[i] || null,
        next: null,
        isTombstone: false,
      };
      elements.push(element);
    }

    for (let i = 0; i < elements.length - 1; i++) {
      elements[i].next = elements[i + 1].id;
    }

    const insertAfterElement = this.getElement(op.insertAfterId);
    const originalNext = insertAfterElement ? insertAfterElement.next : this.head;
    elements[elements.length - 1].next = originalNext;

    if (insertAfterElement) {
      let sibling = insertAfterElement.next;
      let predecessor = insertAfterElement;

      while (sibling) {
        const siblingElement = this.getElement(sibling);
        if (!siblingElement) break;

        if (this.compareIds(elements[0].id, siblingElement.id) < 0) {
          break;
        }

        predecessor = siblingElement;
        sibling = siblingElement.next;
      }

      if (predecessor === insertAfterElement) {
        insertAfterElement.next = elements[0].id;
      } else {
        elements[elements.length - 1].next = predecessor.next;
        predecessor.next = elements[0].id;
      }
    } else {
      let current = this.head;
      let predecessor: RGAElement | null = null;

      while (current) {
        const currentElement = this.getElement(current);
        if (!currentElement) break;

        if (this.compareIds(elements[0].id, currentElement.id) < 0) {
          break;
        }

        predecessor = currentElement;
        current = currentElement.next;
      }

      if (!predecessor) {
        elements[elements.length - 1].next = this.head;
        this.head = elements[0].id;
      } else {
        elements[elements.length - 1].next = predecessor.next;
        predecessor.next = elements[0].id;
      }
    }

    for (const element of elements) {
      this.addElement(element);
    }

    for (const elementId of op.newElementIds) {
      this.processPendingOps(this.idToString(elementId));
    }
  }

  applyRemoteBatchDelete(op: BatchDeleteOperation): void {
    if (op.elementIds.length === 0) {
      return;
    }

    for (const elementId of op.elementIds) {
      const elementIdStr = this.idToString(elementId);
      if (!this.hasElement(elementId)) {
        this.addPendingOp(elementIdStr, { ...op, __dependencyId: elementIdStr });
        return;
      }
    }

    this.updateVectorClock(op.vectorClock);
    for (const elementId of op.elementIds) {
      const element = this.getElement(elementId);
      if (element && !element.isTombstone) {
        element.isTombstone = true;
      }
    }
  }

  private processPendingOps(elementIdStr: string): void {
    const pendingOps = this.getAndClearPendingOps(elementIdStr);
    
    for (const pendingOp of pendingOps) {
      if (pendingOp.type === 'insert') {
        this.applyRemoteInsert(pendingOp);
      } else if (pendingOp.type === 'batchInsert') {
        this.applyRemoteBatchInsert(pendingOp);
      } else if (pendingOp.type === 'delete') {
        this.applyRemoteDelete(pendingOp);
      } else {
        this.applyRemoteBatchDelete(pendingOp);
      }
    }
  }

  applyOperation(op: Operation): void {
    if (op.type === 'insert') {
      this.applyRemoteInsert(op);
    } else if (op.type === 'batchInsert') {
      this.applyRemoteBatchInsert(op);
    } else if (op.type === 'delete') {
      this.applyRemoteDelete(op);
    } else {
      this.applyRemoteBatchDelete(op);
    }
  }

  private compareIds(a: PositionIdentifier, b: PositionIdentifier): number {
    if (a.site < b.site) return -1;
    if (a.site > b.site) return 1;
    if (a.clock < b.clock) return -1;
    if (a.clock > b.clock) return 1;
    return 0;
  }

  getPendingOpsCount(): number {
    let count = 0;
    for (const ops of this.pendingOpsByDependency.values()) {
      count += ops.length;
    }
    return count;
  }

  getState(): { 
    head: PositionIdentifier | null; 
    elements: Map<string, RGAElement>; 
    clock: number;
    vectorClock: VectorClock;
  } {
    return {
      head: this.head,
      elements: new Map(this.elements),
      clock: this.clock,
      vectorClock: this.cloneVectorClock(),
    };
  }
}
