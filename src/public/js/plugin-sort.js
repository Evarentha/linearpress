/*
  Plugin Load-Order Drag And Drop

  Frontend drag-and-drop for reordering plugins.

  Authors:
  MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥

  Copyright (C) 2026 Evarentha
  SPDX-License-Identifier: GPL-3.0-or-later
*/
/**
  Enables dragging entries of the plugin list to change their load
  order. On drop, posts the new plugin id sequence to the reorder
  endpoint and briefly shows the sort-status notice on success.
  @since 2.0.1
*/

(() => { const list = document.querySelector('#plugin-list'); const status = document.querySelector('#sort-status'); if (!list || !status) return; let dragged = null; list.addEventListener('dragstart', event => { const item = event.target.closest('li'); dragged = item; item?.classList.add('dragging'); }); list.addEventListener('dragend', () => { dragged?.classList.remove('dragging'); dragged = null; }); list.addEventListener('dragover', event => { event.preventDefault(); const target = event.target.closest('li'); if (!dragged || !target || target === dragged) return; const box = target.getBoundingClientRect(); target.parentNode.insertBefore(dragged, event.clientY < box.top + box.height / 2 ? target : target.nextSibling); }); list.addEventListener('drop', async event => { event.preventDefault(); const ids = [...list.querySelectorAll('li')].map(item => item.dataset.pluginId); const response = await fetch('/admin/plugins/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }); if (response.ok) { status.hidden = false; setTimeout(() => { status.hidden = true; }, 1800); } }); })();
