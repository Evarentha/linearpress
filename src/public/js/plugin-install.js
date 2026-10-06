/*
 * Plugin Install Frontend
 *
 * Implements the plugin install module for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Follow durable server-owned install jobs. The browser never requests a
 * restart or retries an install POST; only a verified completed job succeeds.
 * File queues live in this page, while the current job survives a refresh.
 */
(function () {
  'use strict';
  var status = document.getElementById('install-status');
  var npmForm = document.getElementById('npm-install-form');
  var zipForm = document.getElementById('zip-install-form');
  if (!status || !npmForm || !zipForm) return;

  var progress = document.getElementById('install-progress');
  var resume = document.getElementById('install-resume');
  var login = document.getElementById('install-login');
  var resultLink = document.getElementById('install-result');
  var unlock = document.getElementById('install-unlock');
  var storageKey = 'linearpress.plugin-install.v1';
  var pollWindow = 10 * 60 * 1000;
  var current = null;
  var queue = [];
  var running = false;
  var storageAvailable = true;
  var phases = {
    validating: '正在校验插件包', installing: '正在安装', restarting: '服务器正在重启',
    verifying: '正在验证插件启动', recovering: '正在恢复安全运行状态'
  };
  var controls = Array.prototype.slice.call(document.querySelectorAll(
    '#npm-install-form button, #npm-install-form fluent-button, #npm-install-form input, #npm-install-form fluent-text-input, ' +
    '#zip-install-form button, #zip-install-form fluent-button, #zip-install-form input, #zip-install-form fluent-checkbox'
  ));

  function showStatus(message, kind) {
    status.hidden = false;
    // Keep native/Fluent theme classes, and never interpret server text as HTML.
    status.textContent = message + (storageAvailable ? '' : ' 浏览器禁止保存进度；请保留此页并记录任务编号。');
    status.classList.toggle('notice-ok', kind === 'success');
    status.classList.toggle('notice-error', kind === 'error');
    status.dataset.state = kind || 'pending';
  }

  function syncControls() {
    var locked = Boolean(current) || running;
    controls.forEach(function (control) {
      control.disabled = locked;
      control.toggleAttribute('disabled', locked);
    });
    npmForm.setAttribute('aria-busy', String(running));
    zipForm.setAttribute('aria-busy', String(running));
    progress.hidden = !running;
    resume.hidden = !current || !current.id || running;
    unlock.hidden = !current || Boolean(current.id) || running;
  }

  // FAST upgrades can otherwise reset properties assigned before definition.
  controls.forEach(function (control) {
    if (control.localName.indexOf('fluent-') === 0 && window.customElements) {
      customElements.whenDefined(control.localName).then(syncControls);
    }
  });

  function persist() {
    try {
      if (current) sessionStorage.setItem(storageKey, JSON.stringify(current));
      else sessionStorage.removeItem(storageKey);
    } catch (_) { storageAvailable = false; }
  }

  function validJob(id, statusUrl) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || typeof statusUrl !== 'string') return false;
    try {
      var url = new URL(statusUrl, location.origin);
      return url.origin === location.origin && !url.username && !url.password &&
        ['/admin/plugins/install-jobs/', '/admin/plugins/change-jobs/'].some(function(prefix) { return url.pathname === prefix + encodeURIComponent(id); }) && !url.search && !url.hash;
    } catch (_) { return false; }
  }

  function description() {
    return current ? current.label + '（' + (current.completed + 1) + '/' + current.total + '）' +
      (current.id ? ' · 任务 ' + current.id : '') : '';
  }

  function partial() {
    return current && current.completed ? '已完成 ' + current.completed + '/' + current.total + ' 个；' : '';
  }

  function uncertain() {
    showStatus(description() + '：提交结果尚未确认，不能判断安装成功或失败。请勿重复上传；请先核对插件列表及服务器任务记录。若服务器已受理，关闭页面不会取消任务。', 'warning');
  }

  function authenticationRequired() {
    login.hidden = false;
    showStatus(partial() + '登录已过期，请重新登录后继续查询。这不是安装失败，服务器任务不会因此取消。' +
      (current && current.id ? ' 任务 ' + current.id : ' 提交结果未确认，请核对服务器任务记录，不要重复上传。'), 'warning');
  }

  async function request(url, options, timeout) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeout || 15000);
    try {
      var response = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options, { signal: controller.signal }));
      var data = await response.json().catch(function () { return null; });
      var isLogin = response.status === 401 || (response.redirected && new URL(response.url).pathname === '/login');
      var retryAfter = Number(response.headers.get('Retry-After'));
      return { status: response.status, data: data, login: isLogin, retryAfter: Math.min(30000, Math.max(0, retryAfter * 1000 || 0)) };
    } finally { clearTimeout(timer); }
  }

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  // One bounded monitoring session. Pausing only stops GETs; it never cancels
  // the durable job. Continue starts another bounded session for the same ID.
  async function monitor() {
    var deadline = Date.now() + pollWindow;
    var attempt = 0;
    var needReady = false;
    while (Date.now() < deadline) {
      var retryAfter = 0;
      try {
        if (needReady) {
          var readiness = await request('/__linearpress/ready');
          retryAfter = readiness.retryAfter;
          if (readiness.status !== 200 || !readiness.data || readiness.data.ready !== true) {
            showStatus(description() + '：等待服务器恢复就绪，稍后继续查询；不会重新安装。', 'pending');
          } else { needReady = false; }
        }
        if (!needReady) {
          var result = await request(current.statusUrl);
          retryAfter = result.retryAfter;
          if (result.login) { authenticationRequired(); return 'paused'; }
          if (result.status === 403) {
            showStatus(description() + '：没有查询权限，请联系管理员；任务结果未知，不会重新安装。', 'warning');
            return 'paused';
          }
          var job = result.data && result.data.job;
          if (result.status === 200 && result.data && result.data.ok === true && job && job.id === current.id) {
            if (job.phase === 'completed') return 'completed';
            if (job.phase === 'failed') {
              var diagnostics = typeof job.message === 'string' ? job.message : '请联系管理员检查服务器诊断';
              if (Array.isArray(job.errors)) {
                diagnostics += '；' + job.errors.filter(function (error) { return typeof error === 'string'; }).slice(0, 5).join('；');
              }
              showStatus(partial() + '安装失败：' + diagnostics + '。队列已停止，未上传后续文件。', 'error');
              return 'failed';
            }
            showStatus(description() + '：' + (phases[job.phase] || '等待服务器报告任务状态') +
              (typeof job.message === 'string' && job.message ? ' · ' + job.message : '') + '。关闭页面不影响已受理任务。', 'pending');
            needReady = job.phase === 'restarting' || job.phase === 'recovering';
          } else {
            needReady = result.status >= 500;
            showStatus(description() + '：暂时无法读取任务状态（HTTP ' + result.status + '），将重试查询，不会重新安装。', 'warning');
          }
        }
      } catch (_) {
        needReady = true;
        showStatus(description() + '：连接中断，等待服务器就绪后继续查询。结果尚未确认，请勿重复安装。', 'warning');
      }
      attempt += 1;
      var delay = Math.max(retryAfter, Math.min(15000, 1500 * Math.pow(1.4, Math.min(attempt - 1, 8))));
      await sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
    }
    showStatus(description() + '：自动查询已达到 10 分钟上限，结果仍未确认。后台任务不会取消；点击“继续查询”只查询同一任务，不会重新安装。', 'warning');
    return 'paused';
  }

  async function submit(item, completed, total) {
    current = { id: null, statusUrl: null, label: item.label, completed: completed, total: total };
    persist(); // Also preserve uncertainty if the page closes during the POST.
    resultLink.hidden = true;
    login.hidden = true;
    showStatus(description() + '：正在上传并等待服务器受理，请勿重复提交。', 'pending');
    syncControls();
    try {
      var result = await request(item.url, { method: 'POST', headers: { 'Content-Type': item.type }, body: item.body }, 120000);
      if (result.login) { authenticationRequired(); return false; }
      var data = result.data;
      if (result.status === 202 && data && data.ok === true && validJob(data.jobId, data.statusUrl)) {
        current.id = data.jobId;
        current.statusUrl = new URL(data.statusUrl, location.origin).pathname;
        persist();
        return true;
      }
      // Only an explicit client rejection is safe to call a rejected install.
      // A gateway error/lost 202 may have happened after the backend committed.
      if (result.status >= 400 && result.status < 500 && data && data.ok === false) {
        showStatus(partial() + '请求未受理：' + (typeof data.message === 'string' ? data.message : '请检查输入或权限') + '。队列已停止。', 'error');
        current = null;
        persist();
      } else { uncertain(); }
    } catch (_) { uncertain(); }
    return false;
  }

  async function run() {
    if (running) return;
    running = true;
    login.hidden = true;
    syncControls();
    try {
      var completed = current ? current.completed : 0;
      var total = current ? current.total : queue.length;
      while (current || queue.length) {
        if (!current && !await submit(queue.shift(), completed, total)) { queue = []; break; }
        if (!current.id) break;
        var outcome = await monitor();
        if (outcome === 'paused') break;
        if (outcome === 'failed') {
          current = null;
          queue = [];
          persist();
          break;
        }
        var wasConfigurationChange = current.statusUrl.indexOf('/admin/plugins/change-jobs/') === 0;
        completed += 1;
        current = null;
        persist();
        showStatus('操作成功：已完成 ' + completed + '/' + total + ' 个，服务器已完成重启及插件验证。' +
          (!queue.length && completed < total ? ' 页面恢复后，其余文件未上传，请重新选择剩余文件。' : ''), 'success');
        resultLink.hidden = false;
        if (wasConfigurationChange) {
          try {
            var listResponse = await fetch('/admin/plugins', {credentials:'same-origin',cache:'no-store'});
            if (listResponse.ok && !listResponse.redirected) {
              var refreshed = new DOMParser().parseFromString(await listResponse.text(), 'text/html').querySelector('#plugin-list');
              var existingList = document.querySelector('#plugin-list');
              if (refreshed && existingList) existingList.innerHTML = refreshed.innerHTML;
            }
          } catch (_) { /* Verified operation succeeded; the result link can refresh display later. */ }
        }
        // Only now, after server verification, may the next upload start.
      }
    } finally {
      running = false;
      syncControls();
    }
  }

  window.LinearPressPluginChanges = {
    busy: function () { return running || Boolean(current); },
    submit: function (url, payload, label) {
      if (running || current) return false;
      queue = [{url: url, type: 'application/json', body: JSON.stringify(payload || {}), label: label || '插件变更'}];
      run(); return true;
    }
  };
  document.addEventListener('submit', function(event) {
    var form = event.target;
    if (!form.matches || !form.matches('form[action$="/toggle"]')) return;
    event.preventDefault(); window.LinearPressPluginChanges.submit(form.getAttribute('action'), {}, '插件启用／停用');
  });

  npmForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (running || current) return;
    // Fluent's editable value is a property, not the initial value attribute.
    var spec = String(document.getElementById('npm-package-name').value || '').trim();
    if (!/^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+(@[a-zA-Z0-9._-]+)?$/.test(spec)) {
      showStatus('请输入 npm 包名，例如 @scope/plugin-name 或 plugin-name@1.0.0。', 'error');
      return;
    }
    queue = [{ label: spec, url: '/admin/plugins/install-npm', type: 'application/json', body: JSON.stringify({ package: spec }) }];
    run();
  });

  zipForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (running || current) return;
    var files = Array.prototype.slice.call(document.getElementById('zip-file').files || []);
    if (!files.length) { showStatus('请选择 .lpp 插件包（推荐）或兼容 .zip 包。', 'error'); return; }
    if (files.length > 1 && !document.getElementById('zip-batch').checked) {
      showStatus('已选择多个文件；请启用批量安装或只选择一个文件。', 'error');
      return;
    }
    if (files.some(function (file) { return !/\.(lpp|zip)$/i.test(file.name); })) {
      showStatus('只支持 .lpp 或 .zip 文件；尚未上传任何文件。', 'error');
      return;
    }
    queue = files.map(function (file) {
      var lpp = /\.lpp$/i.test(file.name);
      return { label: file.name, url: '/admin/plugins/install-' + (lpp ? 'lpp' : 'zip'),
        type: lpp ? 'application/vnd.linearpress.plugin+zip' : 'application/zip', body: file };
    });
    run();
  });

  resume.addEventListener('click', function () { if (current && current.id) run(); });
  unlock.addEventListener('click', function () {
    if (running) return;
    current = null;
    queue = [];
    persist();
    syncControls();
    showStatus('表单已解锁；未发送任何安装或重启请求。请只在确认服务器没有未完成任务后提交新的安装。', 'warning');
  });

  try {
    var saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (saved && typeof saved.label === 'string' && Number.isInteger(saved.completed) && saved.completed >= 0 &&
        Number.isInteger(saved.total) && saved.total > saved.completed &&
        (saved.id === null || validJob(saved.id, saved.statusUrl))) current = saved;
  } catch (_) { storageAvailable = false; }
  syncControls();
  if (current && current.id) run();
  else if (current) uncertain();
})();
