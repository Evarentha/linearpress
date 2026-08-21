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
        showStatus('插件 ' + data.plugin.name + ' v' + data.plugin.version + ' 已安装。', true);
        setTimeout(function () { location.reload(); }, 800);
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
        showStatus('插件 ' + data.plugin.name + ' v' + data.plugin.version + ' 已安装。', true);
        setTimeout(function () { location.reload(); }, 800);
      })
      .catch(function (error) { promptError('安装失败：' + error.message); })
      .finally(function () { button.disabled = false; });
  });
})();