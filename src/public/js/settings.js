/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
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
