import { Request, Response } from 'express';
import Joi from 'joi';
import DataSource, { DataSourceType } from '../models/DataSource';
import codeGeneratorService from '../services/codeGenerator.service';
import dockerService from '../services/docker.service';
import npmService from '../services/npm.service';
import performancePredictorService from '../services/performancePredictor.service';

const dataSourceSchema = Joi.object({
  name: Joi.string().required(),
  type: Joi.string().valid(...Object.values(DataSourceType)).required(),
  config: Joi.object().required()
});

export class DataSourceController {
  async createDataSource(req: Request, res: Response) {
    try {
      const { error, value } = dataSourceSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { name, type, config } = value;
      const generatedCode = codeGeneratorService.generateCode(type, config, name);

      const dataSource = await DataSource.create({
        name,
        type,
        config,
        generatedCode
      });

      res.status(201).json(dataSource);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getDataSources(req: Request, res: Response) {
    try {
      const dataSources = await DataSource.findAll({
        order: [['createdAt', 'DESC']]
      });
      res.json(dataSources);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getDataSource(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const dataSource = await DataSource.findByPk(id);
      
      if (!dataSource) {
        return res.status(404).json({ error: 'Data source not found' });
      }

      res.json(dataSource);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateDataSource(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { error, value } = dataSourceSchema.validate(req.body);
      
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const dataSource = await DataSource.findByPk(id);
      if (!dataSource) {
        return res.status(404).json({ error: 'Data source not found' });
      }

      const { name, type, config } = value;
      const generatedCode = codeGeneratorService.generateCode(type, config, name);

      await dataSource.update({
        name,
        type,
        config,
        generatedCode
      });

      res.json(dataSource);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async deleteDataSource(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const dataSource = await DataSource.findByPk(id);
      
      if (!dataSource) {
        return res.status(404).json({ error: 'Data source not found' });
      }

      await dataSource.destroy();
      res.json({ message: 'Data source deleted successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async generateCode(req: Request, res: Response) {
    try {
      const { name, type, config } = req.body;
      
      if (!name || !type || !Object.values(DataSourceType).includes(type)) {
        return res.status(400).json({ error: 'Invalid parameters' });
      }

      const generatedCode = codeGeneratorService.generateCode(type, config, name);
      res.json({ code: generatedCode });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async testConnection(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const dataSource = await DataSource.findByPk(id);
      
      if (!dataSource) {
        return res.status(404).json({ error: 'Data source not found' });
      }

      const result = await dockerService.testConnectionInContainer(
        dataSource.type,
        dataSource.config,
        dataSource.name
      );

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async createTestContainer(req: Request, res: Response) {
    try {
      const { type } = req.body;
      
      if (!Object.values(DataSourceType).includes(type)) {
        return res.status(400).json({ error: 'Invalid data source type' });
      }

      const containerInfo = await dockerService.createTestContainer(type);
      
      await dockerService.waitForContainerReady(containerInfo.containerId);

      const credentials: Record<string, any> = {
        [DataSourceType.MYSQL]: {
          username: 'root',
          password: 'test123',
          database: 'testdb',
          port: 3306
        },
        [DataSourceType.POSTGRESQL]: {
          username: 'testuser',
          password: 'testpass',
          database: 'testdb',
          port: 5432
        },
        [DataSourceType.MONGODB]: {
          connectionString: `mongodb://${containerInfo.host}:${containerInfo.port}`,
          port: 27017
        }
      };

      res.json({
        containerId: containerInfo.containerId,
        host: containerInfo.host,
        port: containerInfo.port,
        credentials: credentials[type] || {}
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async stopTestContainer(req: Request, res: Response) {
    try {
      const { containerId } = req.params;
      await dockerService.stopContainer(containerId);
      res.json({ message: 'Container stopped successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async exportNpmPackage(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { version = '1.0.0' } = req.body;

      const dataSource = await DataSource.findByPk(id);
      if (!dataSource) {
        return res.status(404).json({ error: 'Data source not found' });
      }

      const zipBuffer = await npmService.createNpmPackage(
        dataSource.name,
        version,
        dataSource.type,
        dataSource.generatedCode
      );

      const packageName = dataSource.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${packageName}-${version}.zip"`);
      res.send(zipBuffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async predictPoolPerformance(req: Request, res: Response) {
    try {
      const { type, config, testDuration } = req.body;
      
      if (!type || !Object.values(DataSourceType).includes(type)) {
        return res.status(400).json({ error: 'Invalid data source type' });
      }

      const prediction = await performancePredictorService.predictPerformance(
        type,
        config || {},
        testDuration
      );

      res.json(prediction);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getPerformanceReport(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { testDuration } = req.body;

      const dataSource = await DataSource.findByPk(id);
      if (!dataSource) {
        return res.status(404).json({ error: 'Data source not found' });
      }

      const prediction = await performancePredictorService.predictPerformance(
        dataSource.type,
        dataSource.config,
        testDuration
      );

      const report = performancePredictorService.generatePerformanceReport(prediction);

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="performance-report-${dataSource.name}.txt"`);
      res.send(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default new DataSourceController();
