import config from './src/config.js';

const knexConfig = {
  client: 'pg',
  connection: config.databaseUrl,
  pool: {
    min: 2,
    max: config.dbPoolMax,
  },
  migrations: {
    directory: './migrations',
    extension: 'js',
  },
};

export default knexConfig;
