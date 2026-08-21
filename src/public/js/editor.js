(() => {
  const root = document.querySelector('#editor');
  const output = document.querySelector('#content_json');
  if (!root || !output) return;

  let blocks = JSON.parse(root.dataset.content || '[]');
  const definitions = {
    paragraph: { label: '段落', description: '普通正文内容' },
    heading: { label: '标题', description: '文章内的章节标题' },
    blockquote: { label: '引用', description: '突出显示引用或重点内容' },
    image: { label: '图片', description: '图片地址与替代文本' },
    'custom-html': { label: 'HTML', description: '自定义 HTML 代码' }
  };

  const createBlock = (type) => {
    if (type === 'heading') return { type, level: 2, content: '' };
    if (type === 'image') return { type, src: '', alt: '' };
    return { type, content: '' };
  };
  const sync = () => { output.value = JSON.stringify(blocks); };
  const makeField = (value, placeholder, onInput, className = '') => {
    const field = document.createElement('textarea');
    field.className = className;
    field.value = value || '';
    field.placeholder = placeholder;
    field.addEventListener('input', () => onInput(field.value));
    return field;
  };

  const render = () => {
    root.innerHTML = '';
    root.className = 'lp-editor';
    const toolbar = document.createElement('div');
    toolbar.className = 'lp-toolbar';
    Object.entries(definitions).forEach(([type, definition]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `+ ${definition.label}`;
      button.addEventListener('click', () => { blocks.push(createBlock(type)); render(); });
      toolbar.append(button);
    });
    root.append(toolbar);

    if (blocks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'lp-empty';
      empty.textContent = '尚未添加内容区块';
      root.append(empty);
    }

    blocks.forEach((block, index) => {
      const definition = definitions[block.type] || { label: block.type, description: '内容区块' };
      const row = document.createElement('section');
      row.className = `lp-block lp-block-${block.type}`;

      const header = document.createElement('header');
      header.className = 'lp-block-header';
      const identity = document.createElement('div');
      const label = document.createElement('strong');
      label.textContent = definition.label;
      const description = document.createElement('small');
      description.textContent = definition.description;
      identity.append(label, description);

      const actions = document.createElement('div');
      actions.className = 'lp-block-actions';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '删除';
      remove.addEventListener('click', () => { blocks.splice(index, 1); render(); });
      actions.append(remove);
      header.append(identity, actions);

      const body = document.createElement('div');
      body.className = 'lp-block-body';
      if (block.type === 'heading') {
        const level = document.createElement('select');
        [1, 2, 3].forEach((number) => {
          const option = document.createElement('option');
          option.value = String(number);
          option.textContent = `H${number}`;
          option.selected = block.level === number;
          level.append(option);
        });
        level.addEventListener('change', () => { block.level = Number(level.value); sync(); });
        body.append(level, makeField(block.content, '输入章节标题', (value) => { block.content = value; sync(); }));
      } else if (block.type === 'image') {
        const src = document.createElement('input');
        src.type = 'url';
        src.value = block.src || '';
        src.placeholder = 'https://example.com/image.jpg';
        src.addEventListener('input', () => { block.src = src.value; sync(); });
        const alt = document.createElement('input');
        alt.value = block.alt || '';
        alt.placeholder = '图片替代文本';
        alt.addEventListener('input', () => { block.alt = alt.value; sync(); });
        body.append(src, alt);
      } else {
        const placeholders = { paragraph: '输入正文', blockquote: '输入引用内容', 'custom-html': '<div>...</div>' };
        body.append(makeField(block.content, placeholders[block.type] || '输入内容', (value) => { block.content = value; sync(); }, block.type === 'custom-html' ? 'lp-code-field' : ''));
      }

      row.append(header, body);
      root.append(row);
    });
    sync();
  };

  render();
})();
