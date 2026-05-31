import { RGA } from './RGA';

describe('RGA', () => {
  describe('Basic operations', () => {
    test('should initialize with empty text', () => {
      const rga = new RGA('site1');
      expect(rga.getVisibleText()).toBe('');
    });

    test('should insert characters correctly', () => {
      const rga = new RGA('site1');
      rga.localInsert(0, 'H');
      rga.localInsert(1, 'e');
      rga.localInsert(2, 'l');
      rga.localInsert(3, 'l');
      rga.localInsert(4, 'o');
      expect(rga.getVisibleText()).toBe('Hello');
    });

    test('should insert at beginning', () => {
      const rga = new RGA('site1');
      rga.localInsert(0, 'e');
      rga.localInsert(0, 'H');
      expect(rga.getVisibleText()).toBe('He');
    });

    test('should insert in middle', () => {
      const rga = new RGA('site1');
      rga.localInsert(0, 'H');
      rga.localInsert(1, 'l');
      rga.localInsert(1, 'e');
      expect(rga.getVisibleText()).toBe('Hel');
    });

    test('should delete characters correctly', () => {
      const rga = new RGA('site1');
      rga.localInsert(0, 'H');
      rga.localInsert(1, 'e');
      rga.localInsert(2, 'l');
      rga.localInsert(3, 'l');
      rga.localInsert(4, 'o');
      
      rga.localDelete(1);
      expect(rga.getVisibleText()).toBe('Hllo');
      
      rga.localDelete(0);
      expect(rga.getVisibleText()).toBe('llo');
    });
  });

  describe('CRDT synchronization', () => {
    test('two sites should converge with concurrent inserts', () => {
      const rga1 = new RGA('site1');
      const rga2 = new RGA('site2');

      const op1 = rga1.localInsert(0, 'A');
      const op2 = rga2.localInsert(0, 'B');

      rga1.applyRemoteInsert(op2);
      rga2.applyRemoteInsert(op1);

      expect(rga1.getVisibleText()).toBe(rga2.getVisibleText());
      expect(['AB', 'BA']).toContain(rga1.getVisibleText());
    });

    test('multiple concurrent operations should converge', () => {
      const rga1 = new RGA('site1');
      const rga2 = new RGA('site2');

      const op1 = rga1.localInsert(0, 'H');
      const op2 = rga1.localInsert(1, 'i');
      const op3 = rga2.localInsert(0, 'B');
      const op4 = rga2.localInsert(1, 'y');

      rga1.applyRemoteInsert(op3);
      rga1.applyRemoteInsert(op4);
      rga2.applyRemoteInsert(op1);
      rga2.applyRemoteInsert(op2);

      expect(rga1.getVisibleText()).toBe(rga2.getVisibleText());
    });

    test('delete operations should work across sites', () => {
      const rga1 = new RGA('site1');
      const rga2 = new RGA('site2');

      const insertOp = rga1.localInsert(0, 'X');
      rga2.applyRemoteInsert(insertOp);

      expect(rga1.getVisibleText()).toBe('X');
      expect(rga2.getVisibleText()).toBe('X');

      const deleteOp = rga1.localDelete(0);
      if (deleteOp) {
        rga2.applyRemoteDelete(deleteOp);
      }

      expect(rga1.getVisibleText()).toBe('');
      expect(rga2.getVisibleText()).toBe('');
    });

    test('complex scenario: inserts, deletes, and convergence', () => {
      const rga1 = new RGA('site1');
      const rga2 = new RGA('site2');

      const ops1 = [
        rga1.localInsert(0, 'A'),
        rga1.localInsert(1, 'B'),
        rga1.localInsert(2, 'C'),
      ];

      const ops2 = [
        rga2.localInsert(0, '1'),
        rga2.localInsert(1, '2'),
      ];

      ops1.forEach(op => rga2.applyRemoteInsert(op));
      ops2.forEach(op => rga1.applyRemoteInsert(op));

      expect(rga1.getVisibleText()).toBe(rga2.getVisibleText());

      const deleteOp1 = rga1.localDelete(1);
      if (deleteOp1) {
        rga2.applyRemoteDelete(deleteOp1);
      }

      expect(rga1.getVisibleText()).toBe(rga2.getVisibleText());
    });
  });

  describe('Out-of-order operation handling', () => {
    test('should handle out-of-order insert operations (causal dependency)', () => {
      const rga = new RGA('site1');
      const rgaRemote = new RGA('site2');

      const op1 = rgaRemote.localInsert(0, 'H');
      const op2 = rgaRemote.localInsert(1, 'i');

      rga.applyRemoteInsert(op2);
      rga.applyRemoteInsert(op1);

      expect(rga.getVisibleText()).toBe('Hi');
    });

    test('should handle complex out-of-order scenarios with multiple sites', () => {
      const rga1 = new RGA('site1');
      const rga2 = new RGA('site2');
      const rga3 = new RGA('site3');

      const opA1 = rga1.localInsert(0, 'A');
      const opA2 = rga1.localInsert(1, 'B');
      const opB1 = rga2.localInsert(0, 'X');
      const opB2 = rga2.localInsert(1, 'Y');

      rga3.applyRemoteInsert(opA2);
      rga3.applyRemoteInsert(opB2);
      rga3.applyRemoteInsert(opA1);
      rga3.applyRemoteInsert(opB1);

      rga1.applyRemoteInsert(opB1);
      rga1.applyRemoteInsert(opB2);

      rga2.applyRemoteInsert(opA1);
      rga2.applyRemoteInsert(opA2);

      expect(rga1.getVisibleText()).toBe(rga2.getVisibleText());
      expect(rga2.getVisibleText()).toBe(rga3.getVisibleText());
    });

    test('should handle deep causal chains out of order', () => {
      const rgaRemote = new RGA('remote');
      const rga = new RGA('local');

      const ops = [
        rgaRemote.localInsert(0, 'H'),
        rgaRemote.localInsert(1, 'e'),
        rgaRemote.localInsert(2, 'l'),
        rgaRemote.localInsert(3, 'l'),
        rgaRemote.localInsert(4, 'o'),
      ];

      rga.applyRemoteInsert(ops[4]);
      rga.applyRemoteInsert(ops[2]);
      rga.applyRemoteInsert(ops[0]);
      rga.applyRemoteInsert(ops[3]);
      rga.applyRemoteInsert(ops[1]);

      expect(rga.getVisibleText()).toBe('Hello');
    });

    test('should handle out-of-order deletes after inserts', () => {
      const rgaRemote = new RGA('remote');
      const rga = new RGA('local');

      const insertOp = rgaRemote.localInsert(0, 'X');
      const deleteOp = rgaRemote.localDelete(0);

      if (deleteOp) {
        rga.applyRemoteDelete(deleteOp);
        rga.applyRemoteInsert(insertOp);

        expect(rga.getVisibleText()).toBe('');
      }
    });
  });

  describe('Batch operations', () => {
    test('should support local batch insert', () => {
      const rga = new RGA('site1');
      const batchOp = rga.localBatchInsert(0, 'Hello');
      
      expect(batchOp).not.toBeNull();
      expect(batchOp?.type).toBe('batchInsert');
      expect(batchOp?.text).toBe('Hello');
      expect(batchOp?.newElementIds.length).toBe(5);
      expect(rga.getVisibleText()).toBe('Hello');
    });

    test('should support remote batch insert', () => {
      const rga1 = new RGA('site1');
      const rga2 = new RGA('site2');

      const batchOp = rga1.localBatchInsert(0, 'Hello World');
      expect(batchOp).not.toBeNull();
      
      rga2.applyRemoteBatchInsert(batchOp!);
      
      expect(rga1.getVisibleText()).toBe(rga2.getVisibleText());
      expect(rga2.getVisibleText()).toBe('Hello World');
    });

    test('should support local batch delete', () => {
      const rga = new RGA('site1');
      rga.localBatchInsert(0, 'Hello World');
      
      const batchDeleteOp = rga.localBatchDelete(6, 5);
      expect(batchDeleteOp).not.toBeNull();
      expect(batchDeleteOp?.type).toBe('batchDelete');
      expect(batchDeleteOp?.count).toBe(5);
      expect(rga.getVisibleText()).toBe('Hello ');
    });

    test('should support remote batch delete', () => {
      const rga1 = new RGA('site1');
      const rga2 = new RGA('site2');

      const batchInsertOp = rga1.localBatchInsert(0, 'Hello World');
      rga2.applyRemoteBatchInsert(batchInsertOp!);
      
      const batchDeleteOp = rga1.localBatchDelete(0, 6);
      rga2.applyRemoteBatchDelete(batchDeleteOp!);
      
      expect(rga1.getVisibleText()).toBe(rga2.getVisibleText());
      expect(rga2.getVisibleText()).toBe('World');
    });

    test('batch inserts mixed with single inserts should converge', () => {
      const rga1 = new RGA('site1');
      const rga2 = new RGA('site2');

      const batchOp = rga1.localBatchInsert(0, 'Hello');
      const singleOp = rga2.localInsert(0, 'X');

      rga1.applyRemoteInsert(singleOp);
      if (batchOp) {
        rga2.applyRemoteBatchInsert(batchOp);
      }

      expect(rga1.getVisibleText()).toBe(rga2.getVisibleText());
    });

    test('should handle out-of-order batch inserts', () => {
      const rga = new RGA('site1');
      const rgaRemote = new RGA('site2');

      const batchOp1 = rgaRemote.localBatchInsert(0, 'Hello');
      const batchOp2 = rgaRemote.localBatchInsert(5, ' World');

      if (batchOp2) {
        rga.applyRemoteBatchInsert(batchOp2);
      }
      if (batchOp1) {
        rga.applyRemoteBatchInsert(batchOp1);
      }

      expect(rga.getVisibleText()).toBe('Hello World');
    });

    test('should handle out-of-order batch deletes', () => {
      const rgaRemote = new RGA('remote');
      const rga = new RGA('local');

      const insertOp = rgaRemote.localBatchInsert(0, 'Hello');
      const deleteOp = rgaRemote.localBatchDelete(0, 5);

      if (deleteOp) {
        rga.applyRemoteBatchDelete(deleteOp);
      }
      if (insertOp) {
        rga.applyRemoteBatchInsert(insertOp);
      }

      expect(rga.getVisibleText()).toBe('');
    });

    test('empty batch insert should return null', () => {
      const rga = new RGA('site1');
      const result = rga.localBatchInsert(0, '');
      expect(result).toBeNull();
    });

    test('batch delete with count 0 should return null', () => {
      const rga = new RGA('site1');
      const result = rga.localBatchDelete(0, 0);
      expect(result).toBeNull();
    });

    test('batch insert at middle position', () => {
      const rga = new RGA('site1');
      rga.localBatchInsert(0, 'AB');
      rga.localBatchInsert(1, 'XY');
      
      expect(rga.getVisibleText()).toBe('AXYB');
    });
  });

  describe('Edge cases', () => {
    test('should handle duplicate insertions gracefully', () => {
      const rga = new RGA('site1');
      const op = rga.localInsert(0, 'A');
      expect(rga.getVisibleText()).toBe('A');
      
      rga.applyRemoteInsert(op);
      expect(rga.getVisibleText()).toBe('A');
    });

    test('should handle deleting non-existent position', () => {
      const rga = new RGA('site1');
      const result = rga.localDelete(0);
      expect(result).toBeNull();
      expect(rga.getVisibleText()).toBe('');
    });

    test('should handle inserting at multiple positions', () => {
      const rga = new RGA('site1');
      const text = 'Hello World';
      for (let i = 0; i < text.length; i++) {
        rga.localInsert(i, text[i]);
      }
      expect(rga.getVisibleText()).toBe('Hello World');
    });
  });
});
