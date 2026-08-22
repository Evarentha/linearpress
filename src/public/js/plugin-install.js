/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

(function () {
  'use strict';
  var status = document.getElementById('install-status');

  function showStatus(message, ok) {
    status.hidden = false;
    status.textContent = message;
    status.className = 'notice' + (ok ? ' notice-ok' : ' notice-error');
  }

  // 校验失败/安装失败时弹提示
  function promptError(message) {
    showStatus(message, false);
    alert(message);
  }

  function restartAfterInstall(plugin) {
    showStatus('插件 ' + plugin.name + ' v' + plugin.version + ' 已安装，必须重启项目后才能生效。', true);
    if (!window.confirm('插件已安装，但必须重启项目才能生效。现在自动重启并重新加载吗？')) {
      showStatus('插件已安装，但尚未重启项目。确认后请手动重启服务，插件才能生效。', true);
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

  function handleInstallSuccess(plugin) { restartAfterInstall(plugin); }

  var npmForm = document.getElementById('npm-install-form');
  npmForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var input = document.getElementById('npm-package-name');
    var spec = input.value.trim();
    if (!spec) { promptError('请输入 npm 包名'); return; }
    var button = npmForm.querySelector('button');
    button.disabled = true;
    fetch('/admin/plugins/install-npm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: spec })
    })
      .then(function (response) { return response.json().catch(function () { return null; }).then(function (data) { return { status: response.status, data: data }; }); })
      .then(function (result) {
        var data = result.data;
        if (!data || !data.ok) {
          promptError((data && data.message) || '安装失败，请检查服务器日志');
          return;
        }
        handleInstallSuccess(data.plugin);
      })
      .catch(function (error) { promptError('安装失败：' + error.message); })
      .finally(function () { button.disabled = false; });
  });

  var zipForm = document.getElementById('zip-install-form');
  zipForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var input = document.getElementById('zip-file');
    var file = input.files && input.files[0];
    if (!file) { promptError('请选择 .zip 压缩包'); return; }
    if (!/\.zip$/i.test(file.name)) { promptError('只支持 .zip 压缩包'); return; }
    var button = zipForm.querySelector('button');
    button.disabled = true;
    fetch('/admin/plugins/install-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: file
    })
      .then(function (response) { return response.json().catch(function () { return null; }).then(function (data) { return { status: response.status, data: data }; }); })
      .then(function (result) {
        var data = result.data;
        if (!data || !data.ok) {
          promptError((data && data.message) || '安装失败，请检查服务器日志');
          return;
        }
        handleInstallSuccess(data.plugin);
      })
      .catch(function (error) { promptError('安装失败：' + error.message); })
      .finally(function () { button.disabled = false; });
  });
})();