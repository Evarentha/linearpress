/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

(() => {
  const root = document.querySelector('#editor');
  const output = document.querySelector('#content_json');
  const definitions = new Map();
  let blocks = root ? JSON.parse(root.dataset.content || '[]') : [];

  const registerBlock = (type, definition) => {
    definitions.set(type, { label: type, description: '内容区块', fields: [], ...definition });
    if (root) render();
  };
  const api = {
    registerBlock,
    getBlocks: () => structuredClone(blocks),
    setBlocks: (nextBlocks) => { blocks = Array.isArray(nextBlocks) ? structuredClone(nextBlocks) : []; if (root) render(); }
  };
  window.LinearPressEditor = api;

  registerBlock('paragraph', { label: '段落', description: '普通正文内容', fields: [{ key: 'content', control: 'textarea', placeholder: '输入正文', default: '' }] });
  registerBlock('heading', { label: '标题', description: '文章内的章节标题', fields: [{ key: 'level', control: 'select', default: 2, options: [{ value: 1, label: 'H1' }, { value: 2, label: 'H2' }, { value: 3, label: 'H3' }] }, { key: 'content', control: 'textarea', placeholder: '输入章节标题', default: '' }] });
  registerBlock('blockquote', { label: '引用', description: '突出显示引用或重点内容', fields: [{ key: 'content', control: 'textarea', placeholder: '输入引用内容', default: '' }] });
  registerBlock('image', { label: '图片', description: '图片地址与替代文本', fields: [{ key: 'src', control: 'url', placeholder: 'https://example.com/image.jpg', default: '' }, { key: 'alt', control: 'text', placeholder: '图片替代文本', default: '' }] });
  registerBlock('custom-html', { label: 'HTML', description: '自定义 HTML 代码', fields: [{ key: 'content', control: 'textarea', placeholder: '<div>...</div>', default: '', className: 'lp-code-field' }] });

  if (!root || !output) return;
  const sync = () => { output.value = JSON.stringify(blocks); };
  const createBlock = (type, definition) => ({ type, ...Object.fromEntries(definition.fields.map((field) => [field.key, field.default ?? ''])) });
  const createField = (block, field) => {
    let element;
    if (field.control === 'select') {
      element = document.createElement('select');
      for (const item of field.options || []) { const option = document.createElement('option'); option.value = String(item.value); option.textContent = item.label; option.selected = String(block[field.key]) === String(item.value); element.append(option); }
      element.addEventListener('change', () => { const option = (field.options || []).find((item) => String(item.value) === element.value); block[field.key] = option?.value ?? element.value; sync(); });
    } else if (field.control === 'textarea') {
      element = document.createElement('textarea');
      element.value = block[field.key] || '';
      element.addEventListener('input', () => { block[field.key] = element.value; sync(); });
    } else {
      element = document.createElement('input');
      element.type = field.control === 'url' ? 'url' : 'text';
      element.value = block[field.key] || '';
      element.addEventListener('input', () => { block[field.key] = element.value; sync(); });
    }
    element.placeholder = field.placeholder || '';
    if (field.className) element.className = field.className;
    return element;
  };

  function render() {
    root.innerHTML = '';
    root.className = 'lp-editor';
    const toolbar = document.createElement('div');
    toolbar.className = 'lp-toolbar';
    for (const [type, definition] of definitions) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `+ ${definition.label}`;
      button.addEventListener('click', () => { blocks.push(createBlock(type, definition)); render(); });
      toolbar.append(button);
    }
    root.append(toolbar);
    if (blocks.length === 0) { const empty = document.createElement('p'); empty.className = 'lp-empty'; empty.textContent = '尚未添加内容区块'; root.append(empty); }
    blocks.forEach((block, index) => {
      const definition = definitions.get(block.type) || { label: block.type, description: '插件区块', fields: [] };
      const row = document.createElement('section'); row.className = `lp-block lp-block-${block.type}`;
      const header = document.createElement('header'); header.className = 'lp-block-header';
      const identity = document.createElement('div'); const label = document.createElement('strong'); label.textContent = definition.label; const description = document.createElement('small'); description.textContent = definition.description; identity.append(label, description);
      const actions = document.createElement('div'); actions.className = 'lp-block-actions'; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.addEventListener('click', () => { blocks.splice(index, 1); render(); }); actions.append(remove); header.append(identity, actions);
      const body = document.createElement('div'); body.className = 'lp-block-body'; for (const field of definition.fields) body.append(createField(block, field));
      if (definition.fields.length === 1) body.classList.add('lp-block-body-single');
      row.append(header, body); root.append(row);
    });
    sync();
  }
  render();
})();
