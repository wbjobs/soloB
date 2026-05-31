import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';

const JWT_SECRET = process.env.P2P_JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRES_IN = '24h';
const AES_KEY_SIZE = 32;
const AES_IV_SIZE = 16;
const TLS_VERSION = 'TLSv1.3';

export interface NodeCredentials {
  nodeId: string;
  publicKey: string;
  token: string;
}

export interface EncryptedChunk {
  index: number;
  iv: string;
  tag: string;
  data: string;
  hash: string;
}

export interface TLSConfig {
  key: Buffer;
  cert: Buffer;
  ca?: Buffer;
}

let globalAesKey: Buffer | null = null;

export function generateAESKey(): Buffer {
  return crypto.randomBytes(AES_KEY_SIZE);
}

export function setGlobalAESKey(key: Buffer): void {
  globalAesKey = key;
}

export function getGlobalAESKey(): Buffer | null {
  return globalAesKey;
}

export function deriveAESKeyFromSecret(secret: string, salt: string = 'p2p-distributor'): Buffer {
  return crypto.pbkdf2Sync(secret, salt, 100000, AES_KEY_SIZE, 'sha256');
}

export function encryptChunkAES256GCM(chunkData: Buffer, key?: Buffer): EncryptedChunk {
  const encryptionKey = key || globalAesKey;
  if (!encryptionKey) {
    throw new Error('AES key not set');
  }

  const iv = crypto.randomBytes(AES_IV_SIZE);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  
  const encrypted = Buffer.concat([cipher.update(chunkData), cipher.final()]);
  const tag = cipher.getAuthTag();
  const hash = crypto.createHash('sha256').update(encrypted).digest('hex');

  return {
    index: 0,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
    hash
  };
}

export function decryptChunkAES256GCM(encrypted: EncryptedChunk, key?: Buffer): Buffer {
  const decryptionKey = key || globalAesKey;
  if (!decryptionKey) {
    throw new Error('AES key not set');
  }

  const iv = Buffer.from(encrypted.iv, 'base64');
  const tag = Buffer.from(encrypted.tag, 'base64');
  const encryptedData = Buffer.from(encrypted.data, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', decryptionKey, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

export function verifyEncryptedChunkHash(encrypted: EncryptedChunk): boolean {
  const data = Buffer.from(encrypted.data, 'base64');
  const calculatedHash = crypto.createHash('sha256').update(data).digest('hex');
  return calculatedHash === encrypted.hash;
}

export function generateJWT(nodeId: string, ip: string): string {
  return jwt.sign(
    {
      nodeId,
      ip,
      iat: Date.now()
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyJWT(token: string): { valid: boolean; payload?: any; error?: string } {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { valid: true, payload };
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }
}

export function generateRSAKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return { publicKey, privateKey };
}

export function signData(data: string, privateKey: string): string {
  return crypto.sign('sha256', Buffer.from(data), privateKey).toString('base64');
}

export function verifySignature(data: string, signature: string, publicKey: string): boolean {
  try {
    return crypto.verify('sha256', Buffer.from(data), publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

export function generateSelfSignedTLS(): TLSConfig {
  const certDir = path.join(process.cwd(), '.p2p-certs');
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
  }

  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  const privateKeyPem = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDHB+X/UJD8
-----END PRIVATE KEY-----`;

  const certPem = `-----BEGIN CERTIFICATE-----
MIIC+jCCAeICAQAwDQYJKoZIhvcNAQELBQAwFTETMBEGA1UEAxMkUDJQLU5vZGUw
HhcNMjQwMTAxMDAwMDAwWhcNMzUwMTAxMDAwMDAwWjAVMRMwEQYDVQQDEwpQMlAt
Tm9kZTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMwG5f9QkP
-----END CERTIFICATE-----`;

  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  fs.writeFileSync(keyPath, privateKey);
  fs.writeFileSync(certPath, certPem);

  return {
    key: Buffer.from(privateKey),
    cert: Buffer.from(certPem)
  };
}

export function getTLSServerOptions(): any {
  const tlsConfig = generateSelfSignedTLS();
  return {
    key: tlsConfig.key,
    cert: tlsConfig.cert,
    minVersion: TLS_VERSION,
    maxVersion: TLS_VERSION,
    ciphers: 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256',
    rejectUnauthorized: false
  };
}

export function getTLSClientOptions(): any {
  return {
    minVersion: TLS_VERSION,
    maxVersion: TLS_VERSION,
    rejectUnauthorized: false,
    checkServerIdentity: () => undefined
  };
}

export function generateFileEncryptionKey(): string {
  return crypto.randomBytes(AES_KEY_SIZE).toString('hex');
}

export function encryptFileKey(fileKey: string, publicKey: string): string {
  return crypto.publicEncrypt(publicKey, Buffer.from(fileKey, 'hex')).toString('base64');
}

export function decryptFileKey(encryptedKey: string, privateKey: string): string {
  return crypto.privateDecrypt(privateKey, Buffer.from(encryptedKey, 'base64')).toString('hex');
}

export function getJWTSecret(): string {
  return JWT_SECRET;
}
