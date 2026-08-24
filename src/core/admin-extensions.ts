/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

export interface AdminMenuEntry { title: string; link: string; icon?: string; pluginId: string; }
export interface CustomSettingEntry { label: string; link?: string; html?: string; pluginId: string; }
export interface PanelEntry { html: string; pluginId: string; }

/**
 * 后台扩展注册表：
 * - menus：控制台顶部/左侧的二级菜单（可携带图标）。
 * - panels：注入右侧详情面板的 HTML。
 * - customSettings：插件在插件列表中暴露的自定义配置入口。
 */
export class AdminExtensionRegistry {
  private readonly menus: AdminMenuEntry[] = [];
  private readonly panels: PanelEntry[] = [];
  private readonly customSettings: CustomSettingEntry[] = [];
  private currentPluginId = 'core';

  setCurrentPluginId(id: string): void { this.currentPluginId = id; }

  registerMenu(entry: { title: string; link: string; icon?: string }): void {
    this.menus.push({ ...entry, pluginId: this.currentPluginId });
  }

  registerPanel(html: string): void {
    this.panels.push({ html, pluginId: this.currentPluginId });
  }

  registerCustomSetting(entry: { label: string; link?: string; html?: string }): void {
    this.customSettings.push({ ...entry, pluginId: this.currentPluginId });
  }

  listMenus(): AdminMenuEntry[] { return [...this.menus]; }
  listPanels(): PanelEntry[] { return [...this.panels]; }
  listCustomSettings(): CustomSettingEntry[] { return [...this.customSettings]; }

  customSettingsFor(pluginId: string): CustomSettingEntry[] {
    return this.customSettings.filter((item) => item.pluginId === pluginId);
  }

  removePlugin(pluginId: string): void {
    for (let i = this.menus.length - 1; i >= 0; i--) if (this.menus[i].pluginId === pluginId) this.menus.splice(i, 1);
    for (let i = this.panels.length - 1; i >= 0; i--) if (this.panels[i].pluginId === pluginId) this.panels.splice(i, 1);
    for (let i = this.customSettings.length - 1; i >= 0; i--) if (this.customSettings[i].pluginId === pluginId) this.customSettings.splice(i, 1);
  }
}
