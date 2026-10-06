/*
 * LinearPress Supervisor Proxy
 *
 * Implements the supervisor proxy module for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import crypto from 'node:crypto';
import type { Express } from 'express';

/** Only the secret-authenticated loopback gateway may assert forwarding headers. */
export function configureSupervisorProxy(app: Express): void {
  if (process.env.LINEARPRESS_WORKER !== '1') return;
  const secret = process.env.LINEARPRESS_PROXY_TOKEN;
  if (!secret) throw new Error('Supervised worker requires a proxy token');
  app.set('trust proxy', (address: string, hop: number) => hop === 0 && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address));
  app.use((req, res, next) => {
    const supplied = req.headers['x-linearpress-proxy'];
    delete req.headers['x-linearpress-proxy'];
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(secret) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) {
      res.status(403).end('Private worker');
      return;
    }
    next();
  });
}
