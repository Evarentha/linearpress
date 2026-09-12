/*
  Post Slug Generator

  Frontend logic for generating post slugs from titles.

  Authors:
  MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥

  Copyright (C) 2026 Evarentha
  SPDX-License-Identifier: GPL-3.0-or-later
*/
/**
  Generates a URL-friendly slug from the post title by Unicode
  normalization, mark stripping, lowercasing and hyphen separation.
  Keeps manually edited slugs intact, sanitizes slug input on the
  fly, and updates the live /post/ preview line.
  @since 2.0.1
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
