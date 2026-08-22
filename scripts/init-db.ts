/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import { db, runMigrations } from '../src/core/database.js';
runMigrations();
console.log('Database initialized.');
db.close();
