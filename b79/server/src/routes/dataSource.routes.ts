import { Router } from 'express';
import dataSourceController from '../controllers/dataSource.controller';

const router = Router();

router.post('/', dataSourceController.createDataSource);
router.get('/', dataSourceController.getDataSources);
router.get('/:id', dataSourceController.getDataSource);
router.put('/:id', dataSourceController.updateDataSource);
router.delete('/:id', dataSourceController.deleteDataSource);
router.post('/generate-code', dataSourceController.generateCode);
router.post('/:id/test-connection', dataSourceController.testConnection);
router.post('/test-container', dataSourceController.createTestContainer);
router.delete('/test-container/:containerId', dataSourceController.stopTestContainer);
router.post('/:id/export-npm', dataSourceController.exportNpmPackage);
router.post('/predict-performance', dataSourceController.predictPoolPerformance);
router.post('/:id/performance-report', dataSourceController.getPerformanceReport);

export default router;
