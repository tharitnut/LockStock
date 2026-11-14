import knex from 'knex';
import config from './config.js';

const db = knex({
  client: 'pg',
  connection: config.databaseUrl,
  pool: {
    min: 2,
    max: config.dbPoolMax,
  },
});

/**
 * Universal insert helper that handles both PostgreSQL (.returning('id'))
 * and MySQL ([insertId]).
 */
export async function insertAndGetId(builderOrTrx, tableName, data, idColumn = 'id') {
  const isPg = db.client.dialect === 'postgresql' || db.client.config.client === 'pg';
  if (isPg) {
    const [inserted] = await builderOrTrx(tableName).insert(data).returning(idColumn);
    return typeof inserted === 'object' && inserted !== null ? inserted[idColumn] : inserted;
  } else {
    const [insertId] = await builderOrTrx(tableName).insert(data);
    return insertId;
  }
}

export default db;
