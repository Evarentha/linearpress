/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

export interface ServiceToken<T> { readonly key: symbol; readonly name: string; readonly __type?: T; }
export const createToken = <T>(name: string): ServiceToken<T> => ({ key: Symbol.for(`linearpress:${name}`), name });

export class ServiceContainer {
  private services = new Map<symbol, unknown>();

  has<T>(token: ServiceToken<T>): boolean { return this.services.has(token.key); }
  register<T>(token: ServiceToken<T>, service: T): void {
    if (this.services.has(token.key)) throw new Error(`Service already registered: ${token.name}`);
    this.services.set(token.key, service);
  }
  provide<T>(token: ServiceToken<T>, service: T): void { if (!this.has(token)) this.services.set(token.key, service); }
  replace<T>(token: ServiceToken<T>, service: T): T | undefined {
    const previous = this.services.get(token.key) as T | undefined;
    this.services.set(token.key, service);
    return previous;
  }
  resolve<T>(token: ServiceToken<T>): T {
    if (!this.services.has(token.key)) throw new Error(`Service not registered: ${token.name}`);
    return this.services.get(token.key) as T;
  }
  decorate<T>(token: ServiceToken<T>, decorator: (service: T) => T): T {
    const service = decorator(this.resolve(token));
    this.services.set(token.key, service);
    return service;
  }
  remove<T>(token: ServiceToken<T>): boolean { return this.services.delete(token.key); }
}

export const coreContainer = new ServiceContainer();
