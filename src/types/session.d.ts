/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import 'express-session';
declare module 'express-session' {
  interface SessionData { userId?: number; oobeStep?: number; rescueVerified?: boolean; }
}
