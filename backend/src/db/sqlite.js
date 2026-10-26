/**
 * Minimal supabase-js compatible query builder on top of Node's built-in
 * node:sqlite. It implements only what Credloom uses:
 *   from(t).select(cols, {count, head}).eq/neq/gt/gte/lt/lte/in/is(...).order().limit()
 *   .single() / .maybeSingle() ; insert / update / upsert / delete (+ .select())
 * so every route can be written once and run on Supabase or SQLite.
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const BOOLEAN_COLS = new Set(['active', 'resolved', 'insurance_required', 'accepting']);
const JSON_COLS = new Set(['meta', 'details']);

function normalizeOut(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (BOOLEAN_COLS.has(k) && out[k] !== null) out[k] = !!out[k];
    if (JSON_COLS.has(k) && typeof out[k] === 'string') {
      try { out[k] = JSON.parse(out[k]); } catch { /* keep raw */ }
    }
  }
  return out;
}

function normalizeIn(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined) return null;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

class Query {
  constructor(db, table) {
    this.db = db; this.table = table;
    this.op = 'select'; this.cols = '*'; this.opts = {};
    this.where = []; this.params = [];
    this.orderBy = []; this.lim = null;
    this.payload = null; this.conflict = null; this.returning = false;
    this.mode = 'many';
  }
  select(cols = '*', opts = {}) {
    if (this.op === 'select') { this.cols = cols; this.opts = opts; } else this.returning = true;
    return this;
  }
  insert(rows) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(vals) { this.op = 'update'; this.payload = vals; return this; }
  upsert(rows, o = {}) { this.op = 'upsert'; this.payload = Array.isArray(rows) ? rows : [rows]; this.conflict = o.onConflict; return this; }
  delete() { this.op = 'delete'; return this; }
  _f(col, sql, val) { this.where.push(`"${col}" ${sql}`); if (val !== undefined) this.params.push(normalizeIn(val)); return this; }
  eq(c, v) { return this._f(c, '= ?', v); }
  neq(c, v) { return this._f(c, '!= ?', v); }
  gt(c, v) { return this._f(c, '> ?', v); }
  gte(c, v) { return this._f(c, '>= ?', v); }
  lt(c, v) { return this._f(c, '< ?', v); }
  lte(c, v) { return this._f(c, '<= ?', v); }
  is(c, v) { return v === null ? this._f(c, 'IS NULL') : this._f(c, '= ?', v); }
  in(c, arr) {
    if (!arr.length) { this.where.push('1 = 0'); return this; }
    this.where.push(`"${c}" IN (${arr.map(() => '?').join(',')})`);
    this.params.push(...arr.map(normalizeIn)); return this;
  }
  order(c, { ascending = true } = {}) { this.orderBy.push(`"${c}" ${ascending ? 'ASC' : 'DESC'}`); return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }

  _whereSql() { return this.where.length ? ' WHERE ' + this.where.join(' AND ') : ''; }

  _run() {
    const t = `"${this.table}"`;
    try {
      let rows = [];
      let count = null;
      if (this.op === 'select') {
        if (this.opts.count) {
          count = this.db.prepare(`SELECT COUNT(*) c FROM ${t}${this._whereSql()}`).get(...this.params).c;
          if (this.opts.head) return { data: null, error: null, count };
        }
        const cols = this.cols === '*' ? '*' : this.cols.split(',').map((c) => `"${c.trim()}"`).join(',');
        let sql = `SELECT ${cols} FROM ${t}${this._whereSql()}`;
        if (this.orderBy.length) sql += ' ORDER BY ' + this.orderBy.join(', ');
        if (this.lim != null) sql += ` LIMIT ${Number(this.lim)}`;
        rows = this.db.prepare(sql).all(...this.params);
      } else if (this.op === 'insert' || this.op === 'upsert') {
        const out = [];
        for (const r of this.payload) {
          const keys = Object.keys(r);
          let sql = `INSERT INTO ${t} (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
          if (this.op === 'upsert' && this.conflict) {
            const upd = keys.filter((k) => k !== this.conflict).map((k) => `"${k}" = excluded."${k}"`).join(', ');
            sql += ` ON CONFLICT("${this.conflict}") DO ${upd ? 'UPDATE SET ' + upd : 'NOTHING'}`;
          }
          sql += ' RETURNING *';
          out.push(this.db.prepare(sql).get(...keys.map((k) => normalizeIn(r[k]))));
        }
        rows = out.filter(Boolean);
      } else if (this.op === 'update') {
        const keys = Object.keys(this.payload);
        const sets = keys.map((k) => `"${k}" = ?`);
        if (this._hasUpdatedAt()) sets.push(`"updated_at" = datetime('now')`);
        const sql = `UPDATE ${t} SET ${sets.join(', ')}${this._whereSql()} RETURNING *`;
        rows = this.db.prepare(sql).all(...keys.map((k) => normalizeIn(this.payload[k])), ...this.params);
      } else if (this.op === 'delete') {
        rows = this.db.prepare(`DELETE FROM ${t}${this._whereSql()} RETURNING *`).all(...this.params);
      }
      rows = rows.map(normalizeOut);
      if (this.op !== 'select' && !this.returning) return { data: null, error: null };
      if (this.mode === 'single') {
        if (rows.length !== 1) {
          return { data: null, error: { code: 'PGRST116', message: `Expected 1 row, got ${rows.length}` } };
        }
        return { data: rows[0], error: null };
      }
      if (this.mode === 'maybe') return { data: rows[0] || null, error: null };
      return { data: rows, error: null, count };
    } catch (e) {
      return { data: null, error: { code: e.code || 'SQLITE', message: e.message } };
    }
  }
  _hasUpdatedAt() {
    return this.db.prepare(`PRAGMA table_info("${this.table}")`).all().some((c) => c.name === 'updated_at');
  }
  then(resolve, reject) { return Promise.resolve(this._run()).then(resolve, reject); }
}

function createSqliteClient(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sqlite.sql'), 'utf8'));
  return { from: (t) => new Query(db, t), driver: 'sqlite', raw: db };
}

module.exports = { createSqliteClient };
