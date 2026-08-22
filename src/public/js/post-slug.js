/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

(() => {
  const title = document.querySelector('#post-title');
  const slug = document.querySelector('#post-slug');
  const preview = document.querySelector('#slug-preview');
  if (!title || !slug || !preview) return;

  const generate = (value) => value
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  let manuallyEdited = slug.dataset.existing === 'true' || slug.value.trim() !== '';
  const updatePreview = () => { preview.textContent = slug.value.trim() || generate(title.value) || 'post'; };
  title.addEventListener('input', () => {
    if (!manuallyEdited) slug.value = generate(title.value);
    updatePreview();
  });
  slug.addEventListener('input', () => {
    manuallyEdited = slug.value.trim() !== '';
    slug.value = generate(slug.value);
    updatePreview();
  });
  updatePreview();
})();
