/*
 * Settings Tabs Frontend
 *
 * Frontend logic for the site settings page.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
  Wires the tab navigation that switches between settings panels,
  and manages the backup-domain list on the domain tab: adding new
  domain rows and removing existing ones before the form is
  submitted.
  @since 2.0.1
*/

(() => {
  const tabs = document.querySelectorAll('.settings-tab');
  const panels = document.querySelectorAll('.settings-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(item => item.classList.toggle('active', item === tab));
      panels.forEach(panel => panel.classList.toggle('active', panel.dataset.panel === target));
    });
  });

  const list = document.getElementById('domain-list');
  const add = document.getElementById('domain-add');
  if (list && add) {
    add.addEventListener('click', () => {
      const row = document.createElement('div');
      row.className = 'domain-row';
      const input = document.createElement('input');
      input.name = 'backupDomains';
      input.placeholder = 'http://cdn.lp.cn:1234';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'domain-remove';
      remove.textContent = '[-]';
      remove.addEventListener('click', () => row.remove());
      row.append(input, remove);
      list.append(row);
    });
    list.addEventListener('click', event => {
      if (event.target.classList.contains('domain-remove')) event.target.closest('.domain-row').remove();
    });
  }
})();
