/*
 * LinearPress Session Type Augmentation
 *
 * express-session SessionData augmentation for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Adds the LinearPress session fields — the signed-in <code>userId</code>,
 * the OOBE wizard step, and the domain-rescue verification flag — to
 * express-session's <code>SessionData</code> interface.
 *
 * @since 2.0.1
 */

import 'express-session';
declare module 'express-session' {
  interface SessionData { userId?: number; oobeStep?: number; rescueVerified?: boolean; }
}
