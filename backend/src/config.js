require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const path = require('path');

const env = process.env;
const isProd = env.NODE_ENV === 'production';

let jwtSecret = env.JWT_SECRET;
if (!jwtSecret || jwtSecret === 'your-secret-key-change-in-production') {
  if (isProd) {
    console.error('JWT_SECRET must be set in production');
    process.exit(1);
  }
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] JWT_SECRET not set: using an ephemeral secret (sessions reset on restart)');
}

module.exports = {
  isProd,
  port: Number(env.PORT || 3001),
  jwtSecret,
  jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
  dbDriver: (env.DB_DRIVER || 'sqlite').toLowerCase(),
  sqliteFile: env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'credloom.db'),
  supabaseUrl: env.SUPABASE_URL,
  supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY,
  chainServiceUrl: (env.CHAIN_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, ''),
  chainServiceKey: env.SERVICE_API_KEY || '',
  mlServiceUrl: (env.ML_SERVICE_URL || 'http://127.0.0.1:5001').replace(/\/$/, ''),
  corsOrigins: (env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((s) => s.trim()),
  autoDefault: (env.AUTO_DEFAULT || 'true') === 'true',
  autoDefaultIntervalMs: Number(env.AUTO_DEFAULT_INTERVAL_MS || 15000),
  demoMode: (env.DEMO_MODE || 'true') === 'true',
  protocolReservedAccounts: 5, // demo accounts 0-4 are never handed to users
};
