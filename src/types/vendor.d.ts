/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

declare module 'bcryptjs' {
  export function hash(value: string, rounds: number): Promise<string>;
  export function compare(value: string, hash: string): Promise<boolean>;
}
declare module 'express-ejs-layouts' {
  import type { RequestHandler } from 'express';
  const middleware: RequestHandler;
  export default middleware;
}
