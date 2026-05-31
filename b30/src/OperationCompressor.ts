import { InsertOperation, DeleteOperation, BatchInsertOperation, BatchDeleteOperation, PositionIdentifier } from './types';

export interface CompressionOptions {
  maxBatchSize?: number;
  maxTimeWindowMs?: number;
}

interface BufferedInsert {
  operation: InsertOperation;
  receivedAt: number;
}

interface BufferedDelete {
  operation: DeleteOperation;
  receivedAt: number;
}

export class OperationCompressor {
  private readonly maxBatchSize: number;
  private readonly maxTimeWindowMs: number;

  private insertBuffer: BufferedInsert[] = [];
  private deleteBuffer: BufferedDelete[] = [];

  constructor(options: CompressionOptions = {}) {
    this.maxBatchSize = options.maxBatchSize || 50;
    this.maxTimeWindowMs = options.maxTimeWindowMs || 200;
  }

  bufferInsert(op: InsertOperation): void {
    this.insertBuffer.push({
      operation: op,
      receivedAt: Date.now(),
    });
  }

  bufferDelete(op: DeleteOperation): void {
    this.deleteBuffer.push({
      operation: op,
      receivedAt: Date.now(),
    });
  }

  shouldFlushInserts(): boolean {
    if (this.insertBuffer.length === 0) return false;
    
    const firstOp = this.insertBuffer[0];
    const lastOp = this.insertBuffer[this.insertBuffer.length - 1];
    
    if (this.insertBuffer.length >= this.maxBatchSize) {
      return true;
    }
    
    if (lastOp.receivedAt - firstOp.receivedAt >= this.maxTimeWindowMs) {
      return true;
    }
    
    return false;
  }

  shouldFlushDeletes(): boolean {
    if (this.deleteBuffer.length === 0) return false;
    
    const firstOp = this.deleteBuffer[0];
    const lastOp = this.deleteBuffer[this.deleteBuffer.length - 1];
    
    if (this.deleteBuffer.length >= this.maxBatchSize) {
      return true;
    }
    
    if (lastOp.receivedAt - firstOp.receivedAt >= this.maxTimeWindowMs) {
      return true;
    }
    
    return false;
  }

  flushInserts(): BatchInsertOperation[] {
    if (this.insertBuffer.length === 0) {
      return [];
    }

    const batches: BatchInsertOperation[] = [];
    const sortedByPosition = [...this.insertBuffer].sort((a, b) => 
      a.operation.position - b.operation.position
    );

    let currentBatch: BufferedInsert[] = [sortedByPosition[0]];

    for (let i = 1; i < sortedByPosition.length; i++) {
      const prevOp = currentBatch[currentBatch.length - 1].operation;
      const currOp = sortedByPosition[i].operation;
      
      if (this.canMergeInserts(prevOp, currOp, currentBatch.length)) {
        currentBatch.push(sortedByPosition[i]);
      } else {
        batches.push(this.createBatchInsert(currentBatch));
        currentBatch = [sortedByPosition[i]];
      }
    }

    if (currentBatch.length > 0) {
      batches.push(this.createBatchInsert(currentBatch));
    }

    this.insertBuffer = [];
    return batches;
  }

  flushDeletes(): BatchDeleteOperation[] {
    if (this.deleteBuffer.length === 0) {
      return [];
    }

    const batches: BatchDeleteOperation[] = [];
    const sortedByPosition = [...this.deleteBuffer].sort((a, b) => 
      a.operation.position - b.operation.position
    );

    let currentBatch: BufferedDelete[] = [sortedByPosition[0]];

    for (let i = 1; i < sortedByPosition.length; i++) {
      const prevOp = currentBatch[currentBatch.length - 1].operation;
      const currOp = sortedByPosition[i].operation;
      
      if (this.canMergeDeletes(prevOp, currOp, currentBatch.length)) {
        currentBatch.push(sortedByPosition[i]);
      } else {
        batches.push(this.createBatchDelete(currentBatch));
        currentBatch = [sortedByPosition[i]];
      }
    }

    if (currentBatch.length > 0) {
      batches.push(this.createBatchDelete(currentBatch));
    }

    this.deleteBuffer = [];
    return batches;
  }

  flushAll(): { inserts: BatchInsertOperation[]; deletes: BatchDeleteOperation[] } {
    return {
      inserts: this.flushInserts(),
      deletes: this.flushDeletes(),
    };
  }

  private canMergeInserts(prev: InsertOperation, curr: InsertOperation, batchSize: number): boolean {
    if (batchSize >= this.maxBatchSize) {
      return false;
    }

    const expectedNextPosition = prev.position + 1;
    if (curr.position !== expectedNextPosition) {
      return false;
    }

    if (prev.clientId !== curr.clientId) {
      return false;
    }

    return true;
  }

  private canMergeDeletes(prev: DeleteOperation, curr: DeleteOperation, batchSize: number): boolean {
    if (batchSize >= this.maxBatchSize) {
      return false;
    }

    const expectedNextPosition = prev.position - 1;
    if (curr.position !== expectedNextPosition) {
      return false;
    }

    if (prev.clientId !== curr.clientId) {
      return false;
    }

    return true;
  }

  private createBatchInsert(buffered: BufferedInsert[]): BatchInsertOperation {
    const firstOp = buffered[0].operation;
    
    const text = buffered.map(b => b.operation.char).join('');
    const newElementIds: PositionIdentifier[] = buffered.map(b => b.operation.newElementId);
    
    return {
      type: 'batchInsert',
      position: firstOp.position,
      text,
      insertAfterId: firstOp.insertAfterId,
      newElementIds,
      clientId: firstOp.clientId,
      timestamp: Date.now(),
      vectorClock: firstOp.vectorClock,
    };
  }

  private createBatchDelete(buffered: BufferedDelete[]): BatchDeleteOperation {
    const lastOp = buffered[buffered.length - 1].operation;
    
    const elementIds: PositionIdentifier[] = buffered.map(b => b.operation.elementId);
    
    return {
      type: 'batchDelete',
      position: lastOp.position,
      count: elementIds.length,
      elementIds,
      clientId: lastOp.clientId,
      timestamp: Date.now(),
      vectorClock: lastOp.vectorClock,
    };
  }

  getInsertBufferSize(): number {
    return this.insertBuffer.length;
  }

  getDeleteBufferSize(): number {
    return this.deleteBuffer.length;
  }
}
