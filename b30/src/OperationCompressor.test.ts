import { RGA } from './RGA';
import { OperationCompressor } from './OperationCompressor';

describe('OperationCompressor', () => {
  describe('Insert compression', () => {
    test('should compress sequential single character inserts', () => {
      const rga = new RGA('client1');
      const compressor = new OperationCompressor();

      const op1 = rga.localInsert(0, 'H');
      const op2 = rga.localInsert(1, 'e');
      const op3 = rga.localInsert(2, 'l');
      const op4 = rga.localInsert(3, 'l');
      const op5 = rga.localInsert(4, 'o');

      compressor.bufferInsert(op1);
      compressor.bufferInsert(op2);
      compressor.bufferInsert(op3);
      compressor.bufferInsert(op4);
      compressor.bufferInsert(op5);

      const batches = compressor.flushInserts();
      expect(batches.length).toBe(1);
      expect(batches[0].type).toBe('batchInsert');
      expect(batches[0].text).toBe('Hello');
      expect(batches[0].newElementIds.length).toBe(5);
    });

    test('should not compress non-sequential inserts', () => {
      const rga = new RGA('client1');
      const compressor = new OperationCompressor();

      const op1 = rga.localInsert(0, 'A');
      const op2 = rga.localInsert(5, 'B');

      compressor.bufferInsert(op1);
      compressor.bufferInsert(op2);

      const batches = compressor.flushInserts();
      expect(batches.length).toBe(2);
    });

    test('should respect max batch size', () => {
      const rga = new RGA('client1');
      const compressor = new OperationCompressor({ maxBatchSize: 3 });

      const ops = [];
      for (let i = 0; i < 10; i++) {
        ops.push(rga.localInsert(i, String.fromCharCode(65 + i)));
      }

      ops.forEach(op => compressor.bufferInsert(op));

      const batches = compressor.flushInserts();
      expect(batches.length).toBe(4);
      expect(batches[0].text).toBe('ABC');
      expect(batches[1].text).toBe('DEF');
      expect(batches[2].text).toBe('GHI');
      expect(batches[3].text).toBe('J');
    });

    test('should compress on flush even if not yet ready', () => {
      const rga = new RGA('client1');
      const compressor = new OperationCompressor();

      const op1 = rga.localInsert(0, 'A');
      const op2 = rga.localInsert(1, 'B');

      compressor.bufferInsert(op1);
      compressor.bufferInsert(op2);

      const batches = compressor.flushInserts();
      expect(batches.length).toBe(1);
      expect(batches[0].text).toBe('AB');
    });
  });

  describe('Delete compression', () => {
    test('should compress sequential deletes from operation log', () => {
      const rga = new RGA('client1');
      const compressor = new OperationCompressor();

      rga.localBatchInsert(0, 'Hello');

      const deleteOp1 = rga.localDelete(4);
      const deleteOp2 = rga.localDelete(3);
      const deleteOp3 = rga.localDelete(2);

      if (deleteOp1) compressor.bufferDelete(deleteOp1);
      if (deleteOp2) compressor.bufferDelete(deleteOp2);
      if (deleteOp3) compressor.bufferDelete(deleteOp3);

      const batches = compressor.flushDeletes();
      expect(batches.length).toBeGreaterThanOrEqual(1);
    });

    test('should not compress deletes from different clients', () => {
      const rga1 = new RGA('client1');
      const rga2 = new RGA('client2');
      const compressor = new OperationCompressor();

      rga1.localBatchInsert(0, 'ABCDE');
      rga2.localBatchInsert(0, 'ABCDE');

      const op1 = rga1.localDelete(4);
      const op2 = rga2.localDelete(0);

      if (op1) compressor.bufferDelete(op1);
      if (op2) compressor.bufferDelete(op2);

      const batches = compressor.flushDeletes();
      expect(batches.length).toBe(2);
    });
  });

  describe('Flush conditions', () => {
    test('should not flush when buffer is empty', () => {
      const compressor = new OperationCompressor();
      expect(compressor.shouldFlushInserts()).toBe(false);
      expect(compressor.shouldFlushDeletes()).toBe(false);
    });

    test('should flush when max batch size is reached', () => {
      const rga = new RGA('client1');
      const compressor = new OperationCompressor({ maxBatchSize: 3 });

      for (let i = 0; i < 2; i++) {
        compressor.bufferInsert(rga.localInsert(i, String.fromCharCode(65 + i)));
      }
      expect(compressor.shouldFlushInserts()).toBe(false);

      compressor.bufferInsert(rga.localInsert(2, 'C'));
      expect(compressor.shouldFlushInserts()).toBe(true);
    });
  });

  describe('Integration with RGA', () => {
    test('compressed insert operations should be correctly applied by remote RGA', () => {
      const rgaLocal = new RGA('client1');
      const rgaRemote = new RGA('client2');
      const compressor = new OperationCompressor();

      const singleOps = [];
      const text = 'Hello World';
      for (let i = 0; i < text.length; i++) {
        singleOps.push(rgaLocal.localInsert(i, text[i]));
      }

      singleOps.forEach(op => compressor.bufferInsert(op));
      const batches = compressor.flushInserts();

      expect(batches.length).toBeGreaterThanOrEqual(1);

      batches.forEach(batch => {
        rgaRemote.applyRemoteBatchInsert(batch);
      });

      expect(rgaRemote.getVisibleText()).toBe('Hello World');
    });

    test('batch insert and single insert should have same effect', () => {
      const rgaBatch = new RGA('client1');
      const rgaSingle = new RGA('client1');

      const text = 'Hello';
      
      rgaBatch.localBatchInsert(0, text);

      for (let i = 0; i < text.length; i++) {
        rgaSingle.localInsert(i, text[i]);
      }

      expect(rgaBatch.getVisibleText()).toBe(rgaSingle.getVisibleText());
      expect(rgaBatch.getVisibleText()).toBe('Hello');
    });

    test('batch delete should delete multiple characters', () => {
      const rga = new RGA('client1');
      rga.localBatchInsert(0, 'Hello World');
      
      const batchDeleteOp = rga.localBatchDelete(0, 5);
      expect(batchDeleteOp).not.toBeNull();
      expect(rga.getVisibleText()).toBe(' World');
    });

    test('remote batch operations should maintain consistency', () => {
      const rga1 = new RGA('client1');
      const rga2 = new RGA('client2');

      const batchInsertOp = rga1.localBatchInsert(0, 'Test');
      if (batchInsertOp) {
        rga2.applyRemoteBatchInsert(batchInsertOp);
      }

      expect(rga1.getVisibleText()).toBe(rga2.getVisibleText());
      expect(rga2.getVisibleText()).toBe('Test');

      const batchDeleteOp = rga1.localBatchDelete(0, 2);
      if (batchDeleteOp) {
        rga2.applyRemoteBatchDelete(batchDeleteOp);
      }

      expect(rga1.getVisibleText()).toBe(rga2.getVisibleText());
      expect(rga2.getVisibleText()).toBe('st');
    });
  });

  describe('Buffer management', () => {
    test('should clear buffer after flush', () => {
      const rga = new RGA('client1');
      const compressor = new OperationCompressor();

      compressor.bufferInsert(rga.localInsert(0, 'A'));
      expect(compressor.getInsertBufferSize()).toBe(1);

      compressor.flushInserts();
      expect(compressor.getInsertBufferSize()).toBe(0);
    });

    test('flushAll should flush both buffers', () => {
      const rga = new RGA('client1');
      const compressor = new OperationCompressor();

      rga.localBatchInsert(0, 'ABC');
      
      compressor.bufferInsert(rga.localInsert(3, 'D'));
      compressor.bufferDelete(rga.localDelete(0)!);

      const result = compressor.flushAll();
      expect(result.inserts.length).toBe(1);
      expect(result.deletes.length).toBe(1);
      expect(compressor.getInsertBufferSize()).toBe(0);
      expect(compressor.getDeleteBufferSize()).toBe(0);
    });
  });
});
