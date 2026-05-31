// GHZ State Preparation
// 4-qubit GHZ state
OPENQASM 3.0;

qreg q[4];

h q[0];
cx q[0], q[1];
cx q[1], q[2];
cx q[2], q[3];
