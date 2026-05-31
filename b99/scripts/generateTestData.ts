import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'coldchain',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
});

function generateTemperature(base: number, time: number): number {
  const noise = Math.sin(time / 60000) * 2 + Math.random() * 0.5;
  return base + noise;
}

function generateHumidity(): number {
  return 50 + Math.random() * 30;
}

function generateLocation(baseLng: number, baseLat: number, index: number): { lng: number, lat: number } {
  const move = index * 0.001;
  return {
    lng: baseLng + move,
    lat: baseLat + Math.sin(index * 0.1) * 0.005
  };
}

async function generateDeviceData(deviceId: string, startTime: number, pointCount: number): Promise<void> {
  const values: any[] = [];
  let baseTemp = -20;

  for (let i = 0; i < pointCount; i++) {
    const timestamp = startTime + i * 10000;
    const temperature = generateTemperature(baseTemp, timestamp);
    const humidity = generateHumidity();
    const location = generateLocation(116.404, 39.915, i);

    values.push(
      deviceId,
      new Date(timestamp),
      temperature,
      humidity,
      location.lat,
      location.lng,
      95 - Math.floor(i / 100) * 5,
      false,
      false
    );

    if (i === Math.floor(pointCount * 0.7)) {
      baseTemp = -5;
    }
  }

  const placeholders = values.map((_, i) => {
    const base = i * 9;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
  }).join(', ');

  const query = `
    INSERT INTO sensor_data (device_id, timestamp, temperature, humidity, latitude, longitude, battery, is_compressed, is_virtual)
    VALUES ${placeholders}
  `;

  await pool.query(query, values);
  console.log(`Generated ${pointCount} data points for device ${deviceId}`);
}

async function main(): Promise<void> {
  console.log('Generating test data...');

  const now = Date.now();
  const startTime = now - 24 * 60 * 60 * 1000;

  for (let i = 1; i <= 3; i++) {
    await generateDeviceData(`device-00${i}`, startTime, 8640);
  }

  console.log('Test data generation completed!');
  await pool.end();
}

main().catch(console.error);
