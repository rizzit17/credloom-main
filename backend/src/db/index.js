/**
 * Database access. Chooses the driver from DB_DRIVER:
 *   sqlite   (default) zero-config local file at data/credloom.db
 *   supabase           your Supabase project (run supabase_migration.sql first)
 * Both expose the same supabase-js style `db.from(table)...` API.
 */
const config = require('../config');

let client;
if (config.dbDriver === 'supabase') {
  const { createClient } = require('@supabase/supabase-js');
  if (!config.supabaseUrl || !config.supabaseKey) {
    console.error('DB_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  client = createClient(config.supabaseUrl, config.supabaseKey);
  client.driver = 'supabase';
} else {
  client = require('./sqlite').createSqliteClient(config.sqliteFile);
}

module.exports = client;
