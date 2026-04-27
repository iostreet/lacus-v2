(function () {
  const SUPABASE_URL  = 'https://pzodkufrnnjkbghyfwth.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6b2RrdWZybm5qa2JnaHlmd3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMzg2ODAsImV4cCI6MjA5MjgxNDY4MH0.Z_WF2-VVFKTiGF2V4DEcabZYgdxeW_feO4eqcfu1rqU';
  const BUCKET = 'board-images';

  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  let currentSession     = null;
  let currentUserProfile = null;
  let currentDetailPost  = null;
  let editingPostId      = null;
  let activeCategory     = '';
  let allPosts           = [];

  // ── Auth state ────────────────────────────────────────────────────────────
  sb.auth.onAuthStateChange((event, session) => {
    currentSession = session;
    updateNavAuth(session);
    updateWriteBtn(session);
  });

  function updateNavAuth(session) {
    const area = document.getElementById('nav-auth');
    if (!area) return;
    if (session && session.user) {
      area.innerHTML =
        `<span class="site-nav-email">${esc(session.user.email || '')}</span>` +
        `<button class="site-nav-link" onclick="signOut()">Sign Out</button>`;
    } else {
      area.innerHTML = `<a class="site-nav-link" href="/?signin=1">Sign In</a>`;
    }
  }

  function updateWriteBtn(session) {
    const btn = document.getElementById('write-btn');
    if (!btn) return;
    if (session && session.user) {
      btn.disabled = false;
      btn.title = '';
    } else {
      btn.disabled = true;
      btn.title = 'Sign in to write a post';
    }
  }

  window.signOut = async function () {
    await sb.auth.signOut();
    window.location.reload();
  };

  // ── Permission helpers ────────────────────────────────────────────────────
  function isAdmin() {
    return currentUserProfile?.name === 'iostreet';
  }
  function isAuthor(post) {
    return currentSession?.user?.id === post.user_id;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function catClass(cat) {
    return { notice: 'cat-notice', feedback: 'cat-feedback', qna: 'cat-qna' }[cat] || 'cat-notice';
  }

  function catLabel(cat) {
    return { notice: 'Notice', feedback: 'Feedback', qna: 'Q&A' }[cat] || cat;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ── Load posts ─────────────────────────────────────────────────────────────
  async function loadPosts() {
    document.getElementById('board-spinner').style.display = 'block';
    document.getElementById('board-grid').style.display   = 'none';
    document.getElementById('board-empty').style.display  = 'none';

    let query = sb
      .from('board_posts')
      .select('id, category, title, content, created_at, image_url, user_id, user_profiles(name, institution)')
      .order('created_at', { ascending: false });

    if (activeCategory) query = query.eq('category', activeCategory);

    const { data, error } = await query;

    document.getElementById('board-spinner').style.display = 'none';

    if (error) { console.error(error); return; }

    allPosts = data || [];
    renderGrid(allPosts);
  }

  function renderGrid(posts) {
    const grid  = document.getElementById('board-grid');
    const empty = document.getElementById('board-empty');
    grid.innerHTML = '';

    if (!posts.length) {
      empty.style.display = 'block';
      grid.style.display  = 'none';
      return;
    }
    empty.style.display = 'none';
    grid.style.display  = 'grid';

    posts.forEach(post => {
      const card = document.createElement('div');
      card.className = 'post-card';
      card.innerHTML = `
        ${post.image_url
          ? `<img class="post-img" src="${esc(post.image_url)}" alt="" loading="lazy" />`
          : `<div class="post-img-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`
        }
        <div class="post-body">
          <div class="post-meta">
            <span class="post-category ${catClass(post.category)}">${catLabel(post.category)}</span>
            <span class="post-date">${formatDate(post.created_at)}</span>
          </div>
          <div class="post-title">${esc(post.title)}</div>
          <div class="post-preview">${esc(post.content)}</div>
          <div class="post-footer">
            <span class="post-author">${esc(post.user_profiles?.name || 'Anonymous')}</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => openDetail(post));
      grid.appendChild(card);
    });
  }

  // ── Category filter ───────────────────────────────────────────────────────
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeCategory = chip.dataset.cat;
      loadPosts();
    });
  });

  // ── Post detail ───────────────────────────────────────────────────────────
  function openDetail(post) {
    currentDetailPost = post;
    const canEdit   = isAuthor(post);
    const canDelete = isAuthor(post) || isAdmin();

    const body = document.getElementById('detail-body');
    body.innerHTML = `
      ${post.image_url ? `<img class="detail-img" src="${esc(post.image_url)}" alt="" />` : ''}
      <div class="detail-meta">
        <span class="post-category ${catClass(post.category)}">${catLabel(post.category)}</span>
        <span style="font-size:0.78rem;color:var(--gray3)">${formatDate(post.created_at)}</span>
      </div>
      <div class="detail-title">${esc(post.title)}</div>
      <div class="detail-author">${esc(post.user_profiles?.name || 'Anonymous')}</div>
      <div class="detail-content">${esc(post.content)}</div>
      ${canEdit || canDelete ? `
        <div class="detail-actions">
          ${canEdit   ? `<button class="btn-edit"   onclick="openEdit()">Edit</button>`     : ''}
          ${canDelete ? `<button class="btn-delete" onclick="deletePost()">Delete</button>` : ''}
        </div>` : ''}

      <div class="comments-section">
        <div class="comments-title" id="comments-title">Comments</div>
        <div id="comments-list"><span style="color:var(--gray3);font-size:0.84rem">Loading…</span></div>
        ${currentSession
          ? `<div class="comment-form">
               <textarea id="comment-input" placeholder="Write a comment…" maxlength="2000"></textarea>
               <button class="comment-submit-btn" id="comment-submit">Post Comment</button>
             </div>`
          : `<p class="comment-signin-note"><a href="/?signin=1" style="color:var(--accent)">Sign in</a> to leave a comment.</p>`
        }
      </div>
    `;

    document.getElementById('detail-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    loadComments(post.id);

    document.getElementById('comment-submit')?.addEventListener('click', () => submitComment(post.id));
    document.getElementById('comments-list').addEventListener('click', handleCommentAction);
  }

  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeDetail();
  });
  function closeDetail() {
    document.getElementById('detail-overlay').classList.add('hidden');
    document.body.style.overflow = '';
  }

  // ── Write post ────────────────────────────────────────────────────────────
  document.getElementById('write-btn').addEventListener('click', () => {
    if (!currentSession) { window.location.href = '/?signin=1'; return; }
    document.getElementById('write-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  });
  document.getElementById('write-close').addEventListener('click', closeWrite);
  document.getElementById('write-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeWrite();
  });
  function closeWrite() {
    document.getElementById('write-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('write-form').reset();
    document.getElementById('post-image-preview').style.display = 'none';
    document.getElementById('post-image-label').textContent = 'Attach an image (optional, max 5 MB)';
    document.getElementById('write-error').classList.add('hidden');
    editingPostId = null;
    document.getElementById('write-panel-title').textContent = 'Write a Post';
    document.getElementById('write-submit').textContent = 'Publish Post';
  }

  // Image preview
  document.getElementById('post-image').addEventListener('change', function () {
    const file = this.files[0];
    if (!file) return;
    const preview = document.getElementById('post-image-preview');
    document.getElementById('post-image-label').textContent = file.name;
    const reader = new FileReader();
    reader.onload = e => { preview.src = e.target.result; preview.style.display = 'block'; };
    reader.readAsDataURL(file);
  });

  // ── Edit post ─────────────────────────────────────────────────────────────
  window.openEdit = function () {
    const post = currentDetailPost;
    if (!post) return;
    closeDetail();
    editingPostId = post.id;
    document.getElementById('post-category').value = post.category;
    document.getElementById('post-title').value     = post.title;
    document.getElementById('post-content').value   = post.content;
    document.getElementById('write-panel-title').textContent = 'Edit Post';
    document.getElementById('write-submit').textContent      = 'Save Changes';
    document.getElementById('write-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  };

  // ── Delete post ───────────────────────────────────────────────────────────
  window.deletePost = async function () {
    if (!currentDetailPost) return;
    if (!confirm('이 글을 삭제하시겠습니까?')) return;
    const { error } = await sb.from('board_posts').delete().eq('id', currentDetailPost.id);
    if (error) { alert('삭제 실패: ' + error.message); return; }
    closeDetail();
    loadPosts();
  };

  // ── Comments ──────────────────────────────────────────────────────────────
  async function loadComments(postId) {
    const list = document.getElementById('comments-list');
    if (!list) return;
    const { data, error } = await sb
      .from('board_comments')
      .select('id, content, created_at, user_id, user_profiles(name)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) { list.innerHTML = '<span style="color:#f87171;font-size:0.82rem">댓글을 불러오지 못했습니다.</span>'; return; }
    renderComments(data || [], postId);
  }

  function renderComments(comments, postId) {
    const list  = document.getElementById('comments-list');
    const title = document.getElementById('comments-title');
    if (!list) return;
    if (title) title.textContent = `Comments (${comments.length})`;

    if (!comments.length) {
      list.innerHTML = '<p class="no-comments">아직 댓글이 없습니다.</p>';
      return;
    }

    list.innerHTML = comments.map(c => {
      const mine   = currentSession?.user?.id === c.user_id;
      const canDel = mine || isAdmin();
      return `
        <div class="comment-item" data-id="${c.id}" data-post="${postId}">
          <div class="comment-header">
            <span class="comment-author">${esc(c.user_profiles?.name || 'Anonymous')}</span>
            <span class="comment-date">${formatDate(c.created_at)}</span>
          </div>
          <div class="comment-text">${esc(c.content)}</div>
          ${mine || canDel ? `
            <div class="comment-actions">
              ${mine   ? `<button class="cmt-btn cmt-btn-edit"   data-action="edit"   data-id="${c.id}">Edit</button>`   : ''}
              ${canDel ? `<button class="cmt-btn cmt-btn-del"    data-action="delete" data-id="${c.id}">Delete</button>` : ''}
            </div>` : ''}
        </div>`;
    }).join('');
  }

  async function handleCommentAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id     = btn.dataset.id;
    const item   = btn.closest('.comment-item');
    const postId = item?.dataset.post;

    if (action === 'delete') {
      if (!confirm('댓글을 삭제하시겠습니까?')) return;
      const { error } = await sb.from('board_comments').delete().eq('id', id);
      if (error) { alert('삭제 실패: ' + error.message); return; }
      if (postId) loadComments(postId);

    } else if (action === 'edit') {
      const textEl    = item.querySelector('.comment-text');
      const actionsEl = item.querySelector('.comment-actions');
      const current   = textEl.textContent;
      textEl.innerHTML    = `<textarea class="comment-edit-input" maxlength="2000">${esc(current)}</textarea>`;
      actionsEl.innerHTML = `
        <button class="cmt-btn cmt-btn-save"   data-action="save"   data-id="${id}">Save</button>
        <button class="cmt-btn cmt-btn-cancel" data-action="cancel" data-id="${id}">Cancel</button>`;
      textEl.querySelector('textarea').focus();

    } else if (action === 'save') {
      const textarea   = item.querySelector('.comment-edit-input');
      const newContent = textarea?.value.trim();
      if (!newContent) return;
      const { error } = await sb.from('board_comments')
        .update({ content: newContent, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) { alert('수정 실패: ' + error.message); return; }
      if (postId) loadComments(postId);

    } else if (action === 'cancel') {
      if (postId) loadComments(postId);
    }
  }

  async function submitComment(postId) {
    const input = document.getElementById('comment-input');
    const btn   = document.getElementById('comment-submit');
    const content = input?.value.trim();
    if (!content || !currentSession) return;
    btn.disabled = true;
    const { error } = await sb.from('board_comments').insert({
      post_id: postId,
      user_id: currentSession.user.id,
      content,
    });
    btn.disabled = false;
    if (error) { alert('댓글 작성 실패: ' + error.message); return; }
    input.value = '';
    loadComments(postId);
  }

  // Submit
  window.submitPost = async function (e) {
    e.preventDefault();
    if (!currentSession) return;

    const btn = document.getElementById('write-submit');
    const errEl = document.getElementById('write-error');
    btn.disabled = true; btn.textContent = 'Publishing…';
    errEl.classList.add('hidden');

    const category = document.getElementById('post-category').value;
    const title    = document.getElementById('post-title').value.trim();
    const content  = document.getElementById('post-content').value.trim();
    const imageFile = document.getElementById('post-image').files[0];

    let image_url = null;

    if (imageFile) {
      if (imageFile.size > 5 * 1024 * 1024) {
        errEl.textContent = 'Image must be under 5 MB.';
        errEl.classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Publish Post';
        return;
      }
      const ext  = imageFile.name.split('.').pop();
      const path = `${currentSession.user.id}/${Date.now()}.${ext}`;
      const { data: upData, error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(path, imageFile, { contentType: imageFile.type });
      if (upErr) {
        errEl.textContent = 'Image upload failed: ' + upErr.message;
        errEl.classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Publish Post';
        return;
      }
      const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(path);
      image_url = urlData.publicUrl;
    }

    let error;
    if (editingPostId) {
      const updates = { category, title, content };
      if (image_url) updates.image_url = image_url;
      ({ error } = await sb.from('board_posts').update(updates).eq('id', editingPostId));
    } else {
      ({ error } = await sb.from('board_posts').insert({ user_id: currentSession.user.id, category, title, content, image_url }));
    }

    if (error) {
      errEl.textContent = error.message;
      errEl.classList.remove('hidden');
      btn.disabled = false; btn.textContent = editingPostId ? 'Save Changes' : 'Publish Post';
      return;
    }

    closeWrite();
    loadPosts();
  };

  // ── Init ──────────────────────────────────────────────────────────────────
  sb.auth.getSession().then(async ({ data: { session } }) => {
    currentSession = session;
    if (session) {
      const { data } = await sb.from('user_profiles').select('name').eq('id', session.user.id).single();
      currentUserProfile = data;
    }
    updateNavAuth(session);
    updateWriteBtn(session);
    loadPosts();
  });
})();
