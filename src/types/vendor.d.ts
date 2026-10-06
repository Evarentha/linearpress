/*
 * LinearPress Vendor Module Declarations
 *
 * Ambient type shims for untyped vendor modules.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Minimal declarations for the untyped dependencies used by LinearPress:
 * the promise-based <code>bcryptjs</code> hash/compare functions and the
 * <code>express-ejs-layouts</code> middleware default export.
 *
 * @since 2.0.1
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
