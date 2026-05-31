import { Pool, PoolConfig } from 'pg';
import { SensorData, Anomaly, GPSFence } from './types';

class Database {
  private pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
  }

  getPool(): Pool {
    return this.pool;
  }

  async connect(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
      console.log('Database connected successfully');
    } catch (error) {
      console.error('Database connection failed:', error);
      throw error;
    }
  }

  async insertSensorData(data: SensorData, isCompressed: boolean = false): Promise<void> {
    const query = `
      INSERT INTO sensor_data (device_id, timestamp, temperature, humidity, latitude, longitude, battery, is_compressed, is_virtual)
      VALUES ($1, TO_TIMESTAMP($2 / 1000), $3, $4, $5, $6, $7, $8, $9)
    `;
    await this.pool.query(query, [
      data.deviceId,
      data.timestamp,
      data.temperature,
      data.humidity,
      data.latitude,
      data.longitude,
      data.battery,
      isCompressed,
      data.isVirtual || false
    ]);
  }

  async batchInsertSensorData(dataList: SensorData[], isCompressed: boolean = false): Promise<void> {
    if (dataList.length === 0) return;

    const values: any[] = [];
    const placeholders: string[] = [];

    dataList.forEach((data, index) => {
      const base = index * 9;
      placeholders.push(`($${base + 1}, TO_TIMESTAMP($${base + 2} / 1000), $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`);
      values.push(
        data.deviceId,
        data.timestamp,
        data.temperature,
        data.humidity,
        data.latitude,
        data.longitude,
        data.battery,
        isCompressed,
        data.isVirtual || false
      );
    });

    const query = `
      INSERT INTO sensor_data (device_id, timestamp, temperature, humidity, latitude, longitude, battery, is_compressed, is_virtual)
      VALUES ${placeholders.join(', ')}
    `;
    await this.pool.query(query, values);
  }

  async insertAnomaly(anomaly: Anomaly): Promise<void> {
    const query = `
      INSERT INTO anomalies (device_id, anomaly_type, start_time, end_time, description, severity, context_data)
      VALUES ($1, $2, TO_TIMESTAMP($3 / 1000), TO_TIMESTAMP($4 / 1000), $5, $6, $7)
    `;
    await this.pool.query(query, [
      anomaly.deviceId,
      anomaly.anomalyType,
      anomaly.startTime,
      anomaly.endTime,
      anomaly.description,
      anomaly.severity,
      JSON.stringify(anomaly.contextData || [])
    ]);
  }

  async getDeviceDataInRange(
    deviceId: string,
    startTime: number,
    endTime: number
  ): Promise<SensorData[]> {
    const query = `
      SELECT device_id, EXTRACT(EPOCH FROM timestamp) * 1000 as timestamp,
             temperature, humidity, latitude, longitude, battery, is_virtual
      FROM sensor_data
      WHERE device_id = $1
        AND timestamp >= TO_TIMESTAMP($2 / 1000)
        AND timestamp <= TO_TIMESTAMP($3 / 1000)
      ORDER BY timestamp ASC
    `;
    const result = await this.pool.query(query, [deviceId, startTime, endTime]);
    return result.rows.map(row => ({
      deviceId: row.device_id,
      timestamp: parseFloat(row.timestamp),
      temperature: parseFloat(row.temperature),
      humidity: row.humidity ? parseFloat(row.humidity) : undefined,
      latitude: row.latitude ? parseFloat(row.latitude) : undefined,
      longitude: row.longitude ? parseFloat(row.longitude) : undefined,
      battery: row.battery ? parseInt(row.battery) : undefined,
      isVirtual: row.is_virtual
    }));
  }

  async queryAnomalies(
    deviceId: string | undefined,
    startTime: number,
    endTime: number,
    gpsFence?: GPSFence,
    anomalyTypes?: string[]
  ): Promise<Anomaly[]> {
    let query = `
      SELECT a.device_id, a.anomaly_type,
             EXTRACT(EPOCH FROM a.start_time) * 1000 as start_time,
             EXTRACT(EPOCH FROM a.end_time) * 1000 as end_time,
             a.description, a.severity, a.context_data
      FROM anomalies a
      WHERE a.start_time >= TO_TIMESTAMP($1 / 1000)
        AND a.end_time <= TO_TIMESTAMP($2 / 1000)
    `;
    const params: any[] = [startTime, endTime];
    let paramIndex = 3;

    if (deviceId) {
      query += ` AND a.device_id = $${paramIndex}`;
      params.push(deviceId);
      paramIndex++;
    }

    if (anomalyTypes && anomalyTypes.length > 0) {
      query += ` AND a.anomaly_type = ANY($${paramIndex})`;
      params.push(anomalyTypes);
      paramIndex++;
    }

    if (gpsFence) {
      query += `
        AND EXISTS (
          SELECT 1 FROM sensor_data sd
          WHERE sd.device_id = a.device_id
            AND sd.timestamp BETWEEN a.start_time AND a.end_time
            AND sd.latitude BETWEEN $${paramIndex} AND $${paramIndex + 1}
            AND sd.longitude BETWEEN $${paramIndex + 2} AND $${paramIndex + 3}
        )
      `;
      params.push(gpsFence.minLat, gpsFence.maxLat, gpsFence.minLng, gpsFence.maxLng);
    }

    query += ` ORDER BY a.start_time DESC`;

    const result = await this.pool.query(query, params);
    return result.rows.map(row => ({
      deviceId: row.device_id,
      anomalyType: row.anomaly_type,
      startTime: parseFloat(row.start_time),
      endTime: parseFloat(row.end_time),
      description: row.description,
      severity: parseFloat(row.severity),
      contextData: row.context_data
    }));
  }

  async getDeviceStatus(deviceId: string): Promise<any> {
    const query = `
      SELECT device_id, is_online,
             EXTRACT(EPOCH FROM last_seen) * 1000 as last_seen,
             current_temperature, current_humidity,
             active_anomalies, data_count_24h
      FROM device_status
      WHERE device_id = $1
    `;
    const result = await this.pool.query(query, [deviceId]);
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      deviceId: row.device_id,
      isOnline: row.is_online,
      lastSeen: parseFloat(row.last_seen),
      currentTemperature: row.current_temperature ? parseFloat(row.current_temperature) : undefined,
      currentHumidity: row.current_humidity ? parseFloat(row.current_humidity) : undefined,
      activeAnomalies: parseInt(row.active_anomalies),
      dataCount24h: parseInt(row.data_count_24h)
    };
  }

  async updateDeviceOnlineStatus(offlineThresholdMs: number): Promise<void> {
    const query = `
      UPDATE device_status
      SET is_online = CASE
        WHEN last_seen >= NOW() - ($1 * INTERVAL '1 millisecond') THEN TRUE
        ELSE FALSE
      END
    `;
    await this.pool.query(query, [offlineThresholdMs]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export default Database;
