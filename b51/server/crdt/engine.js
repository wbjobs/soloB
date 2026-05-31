class CRDTNode {
  constructor(id, value, originLeft = null, originRight = null, isTombstone = false) {
    this.id = id;
    this.value = value;
    this.originLeft = originLeft;
    this.originRight = originRight;
    this.isTombstone = isTombstone;
  }
}

class CRDTEngine {
  constructor() {
    this.nodes = new Map();
    this.siteId = this.generateSiteId();
    this.counter = 0;
    this.head = null;
    this.tail = null;
  }

  generateSiteId() {
    return Math.random().toString(36).substring(2, 15);
  }

  generateId() {
    this.counter++;
    return `${this.siteId}-${this.counter}`;
  }

  compareIds(id1, id2) {
    if (id1 === id2) return 0;
    const [site1, counter1] = id1.split('-');
    const [site2, counter2] = id2.split('-');
    
    if (site1 !== site2) {
      return site1 < site2 ? -1 : 1;
    }
    return parseInt(counter1) - parseInt(counter2);
  }

  findNodeBefore(position) {
    let current = this.head;
    let visibleCount = 0;
    
    while (current) {
      if (!current.isTombstone) {
        if (visibleCount === position) {
          return { before: current.originLeft, after: current.id };
        }
        visibleCount++;
      }
      current = this.nodes.get(current.originRight);
    }
    
    return { before: this.tail ? this.tail.id : null, after: null };
  }

  insert(position, value) {
    const { before, after } = this.findNodeBefore(position);
    const newId = this.generateId();
    const newNode = new CRDTNode(newId, value, before, after);
    
    this.nodes.set(newId, newNode);
    
    if (before && this.nodes.has(before)) {
      this.nodes.get(before).originRight = newId;
    } else {
      this.head = newNode;
    }
    
    if (after && this.nodes.has(after)) {
      this.nodes.get(after).originLeft = newId;
    } else {
      this.tail = newNode;
    }
    
    return {
      type: 'insert',
      id: newId,
      value: value,
      originLeft: before,
      originRight: after
    };
  }

  delete(position) {
    let current = this.head;
    let visibleCount = 0;
    
    while (current) {
      if (!current.isTombstone) {
        if (visibleCount === position) {
          current.isTombstone = true;
          return {
            type: 'delete',
            id: current.id
          };
        }
        visibleCount++;
      }
      current = this.nodes.get(current.originRight);
    }
    
    return null;
  }

  applyOperation(operation) {
    if (operation.type === 'insert') {
      const { id, value, originLeft, originRight } = operation;
      
      if (this.nodes.has(id)) {
        return;
      }
      
      const newNode = new CRDTNode(id, value, originLeft, originRight);
      this.nodes.set(id, newNode);
      
      if (originLeft && this.nodes.has(originLeft)) {
        const leftNode = this.nodes.get(originLeft);
        const rightNode = leftNode.originRight ? this.nodes.get(leftNode.originRight) : null;
        
        if (!rightNode || rightNode.id === originRight) {
          leftNode.originRight = id;
          if (rightNode) {
            rightNode.originLeft = id;
          }
        } else {
          let current = leftNode;
          while (current.originRight && this.nodes.has(current.originRight)) {
            const next = this.nodes.get(current.originRight);
            if (this.compareIds(next.id, id) > 0) {
              break;
            }
            current = next;
          }
          
          const nextNode = current.originRight ? this.nodes.get(current.originRight) : null;
          newNode.originLeft = current.id;
          newNode.originRight = current.originRight;
          current.originRight = id;
          
          if (nextNode) {
            nextNode.originLeft = id;
          }
        }
      } else {
        let current = this.head;
        while (current && this.compareIds(current.id, id) < 0) {
          current = this.nodes.get(current.originRight);
        }
        
        if (current) {
          newNode.originRight = current.id;
          newNode.originLeft = current.originLeft;
          
          if (current.originLeft) {
            this.nodes.get(current.originLeft).originRight = id;
          } else {
            this.head = newNode;
          }
          current.originLeft = id;
        } else {
          if (this.tail) {
            this.tail.originRight = id;
            newNode.originLeft = this.tail.id;
            this.tail = newNode;
          } else {
            this.head = newNode;
            this.tail = newNode;
          }
        }
      }
      
      if (!originRight && (!this.tail || this.compareIds(this.tail.id, id) < 0)) {
        this.tail = newNode;
      }
    } else if (operation.type === 'delete') {
      if (this.nodes.has(operation.id)) {
        this.nodes.get(operation.id).isTombstone = true;
      }
    }
  }

  getDocument() {
    let result = '';
    let current = this.head;
    
    while (current) {
      if (!current.isTombstone) {
        result += current.value;
      }
      current = current.originRight ? this.nodes.get(current.originRight) : null;
    }
    
    return result;
  }

  getOperations() {
    const operations = [];
    let current = this.head;
    
    while (current) {
      operations.push({
        type: 'insert',
        id: current.id,
        value: current.value,
        originLeft: current.originLeft,
        originRight: current.originRight
      });
      
      if (current.isTombstone) {
        operations.push({
          type: 'delete',
          id: current.id
        });
      }
      
      current = current.originRight ? this.nodes.get(current.originRight) : null;
    }
    
    return operations;
  }

  applyOperations(operations) {
    for (const op of operations) {
      this.applyOperation(op);
    }
  }
}

module.exports = { CRDTEngine, CRDTNode };
