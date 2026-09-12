/*
  Plugin Install Frontend

  Frontend handlers for the plugin install forms.

  Authors:
  MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥

  Copyright (C) 2026 Evarentha
  SPDX-License-Identifier: GPL-3.0-or-later
*/
/**
  Drives the install forms on the plugins page: validates and submits
  npm package specs to the install API, uploads selected ZIP files
  (one by one or in batch mode) to the install endpoint, reports
  per-file progress and errors, and offers an automatic project
  restart once plugins are installed.
  @since 2.0.1
*/

(function () {
  'use strict';
  var status = document.getElementById('install-status');

  function showStatus(message, ok) {
    status.hidden = false;
    status.textContent = message;
    status.className = 'notice' + (ok ? ' notice-ok' : ' notice-error');
  }

  function promptError(message) {
    showStatus(message, false);
    alert(message);
  }

  function restartAfterInstall(plugins) {
    var names = (plugins || []).map(function (plugin) { return plugin.name + ' v' + plugin.version; }).join('、');
    showStatus('插件 ' + names + ' 已安装，必须重启项目后才能生效。', true);
    if (!window.confirm('插件已安装，但必须重启项目才能生效。现在自动重启并重新加载吗？')) {
      showStatus('插件已安装，但尚未重启项目。请手动重启服务，插件才能生效。', true);
      return;
    }
    showStatus('正在重启项目，请稍候…', true);
    fetch('/admin/plugins/restart', { method: 'POST' })
      .then(function (response) { return response.json().catch(function () { return null; }).then(function (data) { return { status: response.status, data: data }; }); })
      .then(function (result) {
        if (!result.data || !result.data.ok) throw new Error((result.data && result.data.message) || '重启请求失败');
        setTimeout(function () { location.href = '/admin/plugins'; }, 1800);
      })
      .catch(function (error) { showStatus('插件已安装，但自动重启失败：' + error.message + '。请手动重启服务。', false); });
  }

  function postJson(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (response) { return response.json().catch(function () { return null; }).then(function (data) { return { status: response.status, data: data }; }); });
  }

  function uploadZip(file) {
    return fetch('/admin/plugins/install-zip', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file })
      .then(function (response) { return response.json().catch(function () { return null; }).then(function (data) { return { status: response.status, data: data }; }); });
  }

  function handleSuccess(plugin) { restartAfterInstall([plugin]); }

  var npmForm = document.getElementById('npm-install-form');
  npmForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var input = document.getElementById('npm-package-name');
    var spec = input.value.trim();
    if (!spec) { promptError('请输入 npm 包名'); return; }
    if (!/^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+(@[a-zA-Z0-9._-]+)?$/.test(spec)) { promptError('包名格式应为 @scope/plugin-name（可选 @version）'); return; }
    var button = npmForm.querySelector('button');
    button.disabled = true;
    postJson('/admin/plugins/install-npm', { package: spec })
      .then(function (result) {
        var data = result.data;
        if (!data || !data.ok) { promptError((data && data.message) || '安装失败，请检查服务器日志'); return; }
        handleSuccess(data.plugin);
      })
      .catch(function (error) { promptError('安装失败：' + error.message); })
      .finally(function () { button.disabled = false; });
  });

  var zipForm = document.getElementById('zip-install-form');
  zipForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var input = document.getElementById('zip-file');
    var batch = document.getElementById('zip-batch');
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) { promptError('请选择 .zip 压缩包'); return; }
    var button = zipForm.querySelector('button');
    button.disabled = true;
    var installed = [];
    var queue = batch.checked ? files : files.slice(0, 1);
    var run = function (index) {
      if (index >= queue.length) {
        button.disabled = false;
        if (installed.length) handleSuccess(installed);
        else showStatus('没有可安装的压缩包。', false);
        return;
      }
      var file = queue[index];
      if (!/\.zip$/i.test(file.name)) { showStatus(file.name + ' 不是 .zip 压缩包，已跳过。', false); run(index + 1); return; }
      showStatus('正在安装 ' + file.name + ' (' + (index + 1) + '/' + queue.length + ')…', true);
      uploadZip(file)
        .then(function (result) {
          var data = result.data;
          if (data && data.ok) installed.push(data.plugin);
          else showStatus(file.name + '：' + ((data && data.message) || '安装失败'), false);
        })
        .catch(function (error) { showStatus(file.name + '：' + error.message, false); })
        .finally(function () { run(index + 1); });
    };
    run(0);
  });
})();
