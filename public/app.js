let isLoginMode = true;
let allNotes = [];
let currentCategory = 'Hepsi';

// Her not için debounce zamanlayıcıları
const autoSaveTimers = {};

// DOM Elementleri
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const authForm = document.getElementById('auth-form');
const authTitle = document.getElementById('auth-title');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authSwitchLink = document.getElementById('auth-switch-link');
const authSwitchPrompt = document.getElementById('auth-switch-prompt');
const usernameGroup = document.getElementById('username-group');
const authError = document.getElementById('auth-error');

const userGreeting = document.getElementById('user-greeting');
const logoutBtn = document.getElementById('logout-btn');
const notesGrid = document.getElementById('notes-grid');
const addNoteBtn = document.getElementById('add-note-btn');
const searchInput = document.getElementById('search-input');
const categoryFilter = document.getElementById('category-filter');

// Oturum Doğrulama
async function checkAuth() {
    try {
        const res = await fetch('/api/me');
        const data = await res.json();
        if (data.loggedIn) {
            showApp(data.username);
        } else {
            showAuth();
        }
    } catch {
        showAuth();
    }
}

function showAuth() {
    authContainer.style.display = 'flex';
    appContainer.style.display = 'none';
}

function showApp(username) {
    authContainer.style.display = 'none';
    appContainer.style.display = 'block';
    userGreeting.innerText = `Merhaba, ${username}`;
    fetchNotes();
}

// Giriş / Kayıt Geçişi
authSwitchLink.addEventListener('click', (e) => {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    authError.innerText = '';
    
    if (isLoginMode) {
        authTitle.innerText = 'Giriş Yap';
        authSubmitBtn.innerText = 'Giriş Yap';
        usernameGroup.style.display = 'none';
        authSwitchLink.innerText = 'Kayıt Ol';
        authSwitchPrompt.innerText = "Hesabın yok mu?";
    } else {
        authTitle.innerText = 'Hesap Oluştur';
        authSubmitBtn.innerText = 'Kayıt Ol';
        usernameGroup.style.display = 'block';
        authSwitchLink.innerText = 'Giriş Yap';
        authSwitchPrompt.innerText = "Zaten hesabın var mı?";
    }
});

// Giriş / Kayıt İşlemi
authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.innerText = '';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const endpoint = isLoginMode ? '/api/login' : '/api/register';
    const body = { email, password };

    if (!isLoginMode) {
        body.username = document.getElementById('username').value.trim();
    }

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();

        if (res.ok) {
            showApp(data.user.username);
        } else {
            authError.innerText = data.error || 'İşlem başarısız.';
        }
    } catch {
        authError.innerText = 'Sunucuya bağlanılamadı.';
    }
});

// Çıkış
logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    showAuth();
});

// Notları Getir
async function fetchNotes() {
    try {
        const res = await fetch('/api/notes');
        if (res.status === 401) {
            showAuth();
            return;
        }
        allNotes = await res.json();
        renderNotes();
    } catch (err) {
        console.error("Notlar alınamadı:", err);
    }
}

// Notları Ekrana Bas
function renderNotes() {
    const searchText = searchInput.value.toLowerCase();
    notesGrid.innerHTML = '';

    const filtered = allNotes.filter(n => {
        const matchCategory = currentCategory === 'Hepsi' || n.category === currentCategory;
        const matchSearch = n.title.toLowerCase().includes(searchText) || (n.content && n.content.toLowerCase().includes(searchText));
        return matchCategory && matchSearch;
    });

    if (filtered.length === 0) {
        notesGrid.innerHTML = '<p style="color: #94a3b8; grid-column: 1/-1; text-align: center; margin-top: 2rem;">Henüz görüntülenecek not yok.</p>';
        return;
    }

    filtered.forEach(note => {
        const card = document.createElement('div');
        card.className = 'note-card';
        card.id = `note-${note.id}`;
        card.style.backgroundColor = note.color;

        card.innerHTML = `
            <div>
                <div class="note-header">
                    <div class="editable-title" 
                         contenteditable="true" 
                         spellcheck="false"
                         oninput="handleAutoSave(${note.id})" 
                         id="title-${note.id}">${escapeHTML(note.title)}</div>
                    <i class="fa-solid fa-thumbtack pin-btn ${note.is_pinned ? 'pin-active' : ''}" 
                       onclick="togglePin(${note.id}, ${note.is_pinned})" title="Sabitle"></i>
                </div>
                <div class="editable-content" 
                     contenteditable="true" 
                     spellcheck="false"
                     placeholder="Not içeriğini düzenle..."
                     oninput="handleAutoSave(${note.id})" 
                     id="content-${note.id}">${escapeHTML(note.content)}</div>
            </div>
            <div class="note-footer">
                <span class="note-tag">${escapeHTML(note.category)}</span>
                <span class="save-indicator" id="status-${note.id}"></span>
                <div class="actions">
                    <i class="fa-solid fa-trash" onclick="deleteNote(${note.id})" title="Sil"></i>
                </div>
            </div>
        `;
        notesGrid.appendChild(card);
    });
}

// Otomatik Kaydetme Tetikleyici (Debounce - 800ms)
function handleAutoSave(noteId) {
    const statusElem = document.getElementById(`status-${noteId}`);
    if (statusElem) {
        statusElem.innerText = 'Yazılıyor...';
        statusElem.className = 'save-indicator';
    }

    // Önceki zamanlayıcı varsa sıfırla (yazmaya devam ediyorsa bekle)
    if (autoSaveTimers[noteId]) {
        clearTimeout(autoSaveTimers[noteId]);
    }

    // Yazmayı bıraktıktan 800ms sonra sunucuya gönder
    autoSaveTimers[noteId] = setTimeout(() => {
        saveNoteChanges(noteId);
    }, 800);
}

// Sunucuya Güncelleme İsteği Atan Fonksiyon
async function saveNoteChanges(noteId) {
    const titleElem = document.getElementById(`title-${noteId}`);
    const contentElem = document.getElementById(`content-${noteId}`);
    const statusElem = document.getElementById(`status-${noteId}`);

    if (!titleElem || !contentElem) return;

    const updatedTitle = titleElem.innerText.trim();
    const updatedContent = contentElem.innerText.trim();

    if (!updatedTitle) {
        if (statusElem) {
            statusElem.innerText = 'Başlık boş olamaz!';
            statusElem.className = 'save-indicator saving';
        }
        return;
    }

    if (statusElem) {
        statusElem.innerText = 'Kaydediliyor...';
        statusElem.className = 'save-indicator saving';
    }

    try {
        const res = await fetch(`/api/notes/${noteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: updatedTitle,
                content: updatedContent
            })
        });

        if (res.ok) {
            // Bellekteki veriyi de senkronize et (filtrelemede bozulmasın)
            const noteObj = allNotes.find(n => n.id === noteId);
            if (noteObj) {
                noteObj.title = updatedTitle;
                noteObj.content = updatedContent;
            }

            if (statusElem) {
                statusElem.innerText = '✓ Kaydedildi';
                statusElem.className = 'save-indicator saved';
                setTimeout(() => {
                    if (statusElem.innerText === '✓ Kaydedildi') {
                        statusElem.innerText = '';
                    }
                }, 2000);
            }
        } else {
            if (statusElem) {
                statusElem.innerText = 'Kaydedilemedi!';
                statusElem.className = 'save-indicator saving';
            }
        }
    } catch {
        if (statusElem) {
            statusElem.innerText = 'Bağlantı hatası!';
        }
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}

// Yeni Not Ekleme
addNoteBtn.addEventListener('click', async () => {
    const titleInput = document.getElementById('note-title');
    const contentInput = document.getElementById('note-content');
    const categoryInput = document.getElementById('note-category');
    const colorInput = document.getElementById('note-color');

    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    const category = categoryInput.value;
    const color = colorInput.value;

    if (!title) {
        alert('Lütfen bir başlık girin.');
        return;
    }

    const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, category, color })
    });

    if (res.ok) {
        titleInput.value = '';
        contentInput.value = '';
        fetchNotes();
    } else {
        alert('Not eklenirken bir hata meydana geldi.');
    }
});

// Not Silme
async function deleteNote(id) {
    if (!confirm('Bu notu silmek istediğinizden emin misiniz?')) return;
    const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    if (res.ok) fetchNotes();
}

// Not Sabitleme
async function togglePin(id, currentStatus) {
    const res = await fetch(`/api/notes/${id}/pin`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_pinned: !currentStatus })
    });
    if (res.ok) fetchNotes();
}

// Kategori Filtresi
categoryFilter.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    document.querySelectorAll('#category-filter li').forEach(el => el.classList.remove('active'));
    li.classList.add('active');
    currentCategory = li.dataset.cat;
    renderNotes();
});

// Arama
searchInput.addEventListener('input', renderNotes);

// Başlat
checkAuth();