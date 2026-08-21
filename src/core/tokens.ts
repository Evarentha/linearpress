import type { SqliteDatabase } from './database.js';
import { createToken } from './service-container.js';
import type { AuthService, CommentService, ConfigService, DatabaseService, GroupService, PermissionService, PluginService, PostService, SessionStoreFactory, UserService } from '../types/services.js';

export const TOKENS = {
  database: createToken<SqliteDatabase>('database'),
  databaseService: createToken<DatabaseService>('database-service'),
  sessionStoreFactory: createToken<SessionStoreFactory>('session-store-factory'),
  auth: createToken<AuthService>('auth'),
  users: createToken<UserService>('users'),
  posts: createToken<PostService>('posts'),
  comments: createToken<CommentService>('comments'),
  groups: createToken<GroupService>('groups'),
  permissions: createToken<PermissionService>('permissions'),
  plugins: createToken<PluginService>('plugins'),
  config: createToken<ConfigService>('config')
} as const;
