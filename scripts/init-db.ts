import { db, runMigrations } from '../src/core/database.js';
runMigrations();
console.log('Database initialized.');
db.close();
