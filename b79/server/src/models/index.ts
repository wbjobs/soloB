import DataSource from './DataSource';
import sequelize from '../config/database';

const initModels = async () => {
  await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
};

export { DataSource, initModels };
