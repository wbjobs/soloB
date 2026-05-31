// Quantum Fourier Transform - 4 qubits
OPENQASM 3.0;

qreg q[4];

h q[0];
rz(pi/2) q[1];
cx q[0], q[1];
rz(-pi/2) q[1];
cx q[0], q[1];
h q[1];

rz(pi/4) q[2];
cx q[0], q[2];
rz(-pi/4) q[2];
cx q[0], q[2];

rz(pi/2) q[2];
cx q[1], q[2];
rz(-pi/2) q[2];
cx q[1], q[2];
h q[2];

rz(pi/8) q[3];
cx q[0], q[3];
rz(-pi/8) q[3];
cx q[0], q[3];

rz(pi/4) q[3];
cx q[1], q[3];
rz(-pi/4) q[3];
cx q[1], q[3];

rz(pi/2) q[3];
cx q[2], q[3];
rz(-pi/2) q[3];
cx q[2], q[3];
h q[3];

swap q[0], q[3];
swap q[1], q[2];
