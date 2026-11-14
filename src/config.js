import dotenv from 'dotenv';
dotenv.config();

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';

const devDefaultSecret = 'your_super_secret_jwt_key_at_least_32_chars';
const jwtSecret = process.env.JWT_SECRET;

if (isProd) {
  if (!jwtSecret || jwtSecret === devDefaultSecret || jwtSecret === 'dev_secret') {
    throw new Error('Fatal: JWT_SECRET must be securely set in production and not use dev default.');
  }
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isTest,
  isProd,
  databaseUrl: isTest
    ? (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL)
    : process.env.DATABASE_URL,
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  rawDatabaseUrl: process.env.DATABASE_URL,
  jwtSecret: jwtSecret || 'dev_secret_only_for_local_development_must_be_long',
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()) : ['*'],
  dbPoolMax: parseInt(process.env.DB_POOL_MAX || (isTest ? '20' : '10'), 10),
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'adminpassword123',
};

export default config;
