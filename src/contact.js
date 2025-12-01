
import { getAllFromDB, getFromDB, putToDB } from './db.js';
import { showToast, showConfirmationModal, formatCurrency, getLocalDateString, updateDashboardSummaries, showPage } from './ui.js';
import { queueSyncAction } from './sync.js';

let currentContactTab = 'customer';
let cachedContacts = [];
let currentLedgerContactId = null;
let currentLedgerType = null; // 'debit' or 'credit'
let editingLedgerEntryId = null;
let searchTimeout = null;

export async function loadContactsPage(initialTab) {
    if (initialTab) {
        currentContactTab = initialTab;
    }
    updateTabUI();
    await fetchAndRenderContacts();
}

export function switchContactTab(tab) {
    currentContactTab = tab;
    updateTabUI();
    fetchAndRenderContacts();
}

function updateTabUI() {
    const customerTab = document.getElementById('customerTab');
    const supplierTab = document.getElementById('supplierTab');
    
    if (currentContactTab === 'customer') {
        customerTab.classList.add('active');
        supplierTab.classList.remove('active');
        document.getElementById('customerListContainer').classList.remove('hidden');
        document.getElementById('supplierListContainer').classList.add('hidden');
    } else {
        supplierTab.classList.add('active');
        customerTab.classList.remove('active');
        document.getElementById('supplierListContainer').classList.remove('hidden');
        document.getElementById('customerListContainer').classList.add('hidden');
    }
}

async function fetchAndRenderContacts(query = '') {
    try {
        const allContacts = await getAllFromDB('contacts');
        const ledgers = await getAllFromDB('ledgers');
        
        // Calculate balances
        const balanceMap = new Map();
        ledgers.forEach(entry => {
            const current = balanceMap.get(entry.contactId) || 0;
            // For simplicity in display:
            // Debit (+) adds to balance (Debt/Receivable increases)
            // Credit (-) subtracts from balance (Payment)
            const amount = entry.type === 'debit' ? entry.amount : -entry.amount;
            balanceMap.set(entry.contactId, current + amount);
        });

        cachedContacts = allContacts.map(c => ({
            ...c,
            balance: balanceMap.get(c.id) || 0
        }));

        const filtered = cachedContacts.filter(c => 
            c.type === currentContactTab && 
            (query === '' || 
             c.name.toLowerCase().includes(query.toLowerCase()) || 
             (c.phone && c.phone.includes(query)) ||
             (c.barcode && c.barcode.includes(query)))
        );

        renderContactsList(filtered);
    } catch (e) {
        console.error("Error loading contacts:", e);
        showToast("Gagal memuat kontak");
    }
}

export function searchContacts(query) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        fetchAndRenderContacts(query);
    }, 300);
}

function renderContactsList(contacts) {
    const type = currentContactTab;
    const listElId = type === 'customer' ? 'customerList' : 'supplierList';
    const listEl = document.getElementById(listElId);

    if (contacts.length === 0) {
        if(!document.getElementById('searchContactInput').value) {
             listEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-users-slash"></i></div>
                    <h3 class="empty-state-title">Belum Ada Kontak</h3>
                    <p class="empty-state-description">Tambahkan ${type === 'customer' ? 'pelanggan' : 'supplier'} baru untuk mulai melacak hutang/piutang.</p>
                    <button onclick="showContactModal()" class="empty-state-action">
                        <i class="fas fa-plus mr-2"></i>Tambah Kontak
                    </button>
                </div>
            `;
        } else {
            listEl.innerHTML = `<div class="text-center py-4 text-gray-500">Tidak ditemukan kontak yang cocok.</div>`;
        }
        return;
    }
    
    listEl.innerHTML = contacts.map(contact => {
        const balance = contact.balance || 0;
        let balanceHtml = '';
        if (balance !== 0) {
             const balanceColor = type === 'customer' ? 'text-teal-600' : 'text-red-600';
             const balanceLabel = type === 'customer' ? 'Piutang' : 'Hutang';
             if (balance > 0) {
                balanceHtml = `<p class="text-sm font-semibold ${balanceColor}">${balanceLabel}: Rp ${formatCurrency(balance)}</p>`;
             } else if (balance < 0) {
                 balanceHtml = `<p class="text-sm font-semibold text-green-600">Deposit: Rp ${formatCurrency(Math.abs(balance))}</p>`;
             }
        } else {
            balanceHtml = `<p class="text-sm text-green-600">Lunas</p>`;
        }
        
        const points = contact.points || 0;
        const pointsHtml = type === 'customer' 
            ? `<p class="text-xs text-gray-500 mt-1"><i class="fas fa-star text-yellow-500 mr-1"></i>${points} Poin</p>`
            : '';

        const resetPointsButtonHtml = (type === 'customer' && points > 0)
            ? `<button onclick="event.stopPropagation(); resetContactPoints(${contact.id})" class="btn bg-yellow-100 text-yellow-700 px-3 py-1 text-xs">Reset Poin</button>`
            : '';

        return `
            <div class="card p-4 clickable" onclick="showLedgerModal(${contact.id})">
                <div class="flex justify-between items-start">
                    <div>
                        <h3 class="font-semibold text-lg">${contact.name}</h3>
                        <p class="text-sm text-gray-500"><i class="fas fa-phone mr-2"></i>${contact.phone || '-'}</p>
                    </div>
                    <div class="text-right">
                         ${balanceHtml}
                         ${pointsHtml}
                    </div>
                </div>
                <div class="flex justify-end gap-2 mt-2 pt-2 border-t">
                    ${resetPointsButtonHtml}
                    <button onclick="event.stopPropagation(); showLedgerModal(${contact.id})" class="btn bg-gray-100 text-gray-700 px-3 py-1 text-xs">Riwayat</button>
                    <button onclick="event.stopPropagation(); showContactModal(${contact.id})" class="btn bg-blue-100 text-blue-700 px-3 py-1 text-xs">Edit</button>
                    <button onclick="event.stopPropagation(); deleteContact(${contact.id})" class="btn bg-red-100 text-red-700 px-3 py-1 text-xs">Hapus</button>
                </div>
            </div>
        `;
    }).join('');
}

export function showContactModal(id = null) {
    const modal = document.getElementById('contactModal');
    const title = document.getElementById('contactModalTitle');
    
    // Reset form
    document.getElementById('contactId').value = '';
    document.getElementById('contactName').value = '';
    document.getElementById('contactPhone').value = '';
    document.getElementById('contactBarcode').value = '';
    document.getElementById('contactAddress').value = '';
    document.getElementById('contactNotes').value = '';
    document.getElementById('contactType').value = currentContactTab;
    
    if (id) {
        title.textContent = 'Edit Kontak';
        getFromDB('contacts', id).then(c => {
            if(c) {
                document.getElementById('contactId').value = c.id;
                document.getElementById('contactName').value = c.name;
                document.getElementById('contactPhone').value = c.phone || '';
                document.getElementById('contactBarcode').value = c.barcode || '';
                document.getElementById('contactAddress').value = c.address || '';
                document.getElementById('contactNotes').value = c.notes || '';
                document.getElementById('contactType').value = c.type;
            }
        });
    } else {
        title.textContent = 'Tambah Kontak';
    }
    
    modal.classList.remove('hidden');
}

export function closeContactModal() {
    document.getElementById('contactModal').classList.add('hidden');
}

export async function saveContact() {
    const id = document.getElementById('contactId').value;
    const name = document.getElementById('contactName').value.trim();
    const phone = document.getElementById('contactPhone').value.trim();
    const barcode = document.getElementById('contactBarcode').value.trim();
    const address = document.getElementById('contactAddress').value.trim();
    const notes = document.getElementById('contactNotes').value.trim();
    const type = document.getElementById('contactType').value;

    if (!name) {
        showToast('Nama kontak wajib diisi');
        return;
    }

    try {
        const allContacts = await getAllFromDB('contacts');
        
        // Validation: Check for duplicate Name + Phone
        const isDuplicate = allContacts.some(c => {
            // If editing, skip the current contact
            if (id && String(c.id) === String(id)) return false;

            const dbName = c.name.toLowerCase();
            const inputName = name.toLowerCase();
            const dbPhone = (c.phone || '').trim();
            
            // Check strict equality for duplicates
            if (phone === '') {
                 return dbName === inputName && dbPhone === '';
            }
            return dbName === inputName && dbPhone === phone;
        });

        if (isDuplicate) {
            showToast('Gagal: Kontak dengan nama dan nomor telepon yang sama sudah ada.');
            return;
        }

        // Validation: Check for duplicate Barcode
        if (barcode) {
            const isBarcodeDuplicate = allContacts.some(c => {
                if (id && String(c.id) === String(id)) return false;
                return c.barcode === barcode;
            });
            
            if (isBarcodeDuplicate) {
                showToast('Gagal: Barcode sudah digunakan oleh kontak lain.');
                return;
            }
        }

        const contact = {
            name, 
            phone, 
            barcode: barcode || null, // Ensure empty string is null to avoid unique constraint errors
            address, 
            notes, 
            type,
            updatedAt: new Date().toISOString()
        };
        
        if (!id) {
            contact.createdAt = new Date().toISOString();
        } else {
            contact.id = parseInt(id);
            // Preserve points if editing
            const old = await getFromDB('contacts', parseInt(id));
            if(old) contact.points = old.points || 0;
        }

        const savedId = await putToDB('contacts', contact);
        await queueSyncAction(id ? 'UPDATE_CONTACT' : 'CREATE_CONTACT', { ...contact, id: savedId });
        showToast('Kontak berhasil disimpan');
        closeContactModal();
        loadContactsPage();
    } catch (e) {
        console.error(e);
        showToast('Gagal menyimpan kontak');
    }
}

export async function deleteContact(id) {
    showConfirmationModal('Hapus Kontak', 'Yakin hapus kontak ini? Semua riwayat hutang/piutang juga akan terhapus.', async () => {
        try {
            // FIX: Fetch data BEFORE starting transaction to avoid "transaction finished" error
            const contact = await getFromDB('contacts', id);
            const ledgers = await getAllFromDB('ledgers', 'contactId', id);
            
            const tx = window.app.db.transaction(['contacts', 'ledgers'], 'readwrite');
            const contactStore = tx.objectStore('contacts');
            const ledgerStore = tx.objectStore('ledgers');
            
            contactStore.delete(id);
            
            ledgers.forEach(l => {
                ledgerStore.delete(l.id);
            });
            
            tx.oncomplete = async () => {
                await queueSyncAction('DELETE_CONTACT', contact || { id });
                showToast('Kontak dihapus');
                if (window.app.currentContactId === id) closeLedgerModal();
                loadContactsPage();
                updateDashboardSummaries();
            };
        } catch(e) {
            console.error(e);
            showToast('Gagal menghapus');
        }
    }, 'Ya, Hapus', 'bg-red-500');
}

export async function resetContactPoints(id) {
     showConfirmationModal('Reset Poin', 'Yakin ingin mereset poin pelanggan ini menjadi 0?', async () => {
        const contact = await getFromDB('contacts', id);
        if(contact) {
            contact.points = 0;
            contact.updatedAt = new Date().toISOString();
            await putToDB('contacts', contact);
            await queueSyncAction('UPDATE_CONTACT', contact);
            showToast('Poin direset');
            loadContactsPage();
        }
     }, 'Ya, Reset', 'bg-yellow-500');
}

// --- LEDGER FUNCTIONS ---

export async function showLedgerModal(contactId) {
    currentLedgerContactId = contactId;
    const modal = document.getElementById('ledgerModal');
    const contact = await getFromDB('contacts', contactId);
    const ledgers = await getAllFromDB('ledgers', 'contactId', contactId);
    
    if (!contact) return;

    document.getElementById('ledgerContactName').textContent = contact.name;
    document.getElementById('ledgerContactType').textContent = contact.type === 'customer' ? 'Pelanggan' : 'Supplier';
    document.getElementById('ledgerContactType').className = `text-sm font-semibold ${contact.type === 'customer' ? 'text-teal-600' : 'text-red-600'}`;
    
    let balance = 0;
    ledgers.forEach(l => {
        balance += l.type === 'debit' ? l.amount : -l.amount;
    });

    const typeLabel = contact.type === 'customer' ? 'Piutang' : 'Hutang';
    document.getElementById('ledgerContactDetails').innerHTML = `
        <p>Total ${typeLabel}: <span class="font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}">Rp ${formatCurrency(balance)}</span></p>
        ${contact.phone ? `<p><i class="fas fa-phone mr-1"></i>${contact.phone}</p>` : ''}
    `;

    const listEl = document.getElementById('ledgerHistory');
    listEl.innerHTML = ledgers.sort((a, b) => new Date(b.date) - new Date(a.date)).map(l => {
        const isDebit = l.type === 'debit'; // Debit adds to debt/receivable
        const color = isDebit ? 'text-red-600' : 'text-green-600';
        const sign = isDebit ? '+' : '-';
        const date = new Date(l.date).toLocaleDateString('id-ID');
        const hasDueDate = l.dueDate;
        const dueDateText = hasDueDate ? `<br><span class="text-xs text-orange-500"><i class="fas fa-clock mr-1"></i>Jatuh Tempo: ${new Date(l.dueDate).toLocaleDateString('id-ID')}</span>` : '';

        return `
            <div class="flex justify-between items-center border-b py-2 relative group">
                <div>
                    <p class="font-semibold text-sm">${l.description || 'Tanpa Keterangan'}</p>
                    <p class="text-xs text-gray-500">${date} ${dueDateText}</p>
                </div>
                <div class="text-right clickable p-2" onclick="showLedgerActions(event, ${l.id}, ${contactId})">
                    <p class="font-bold text-sm ${color}">${sign} Rp ${formatCurrency(l.amount)}</p>
                    <i class="fas fa-ellipsis-v text-gray-400 text-xs"></i>
                </div>
            </div>
        `;
    }).join('');
    
    const debitBtn = document.getElementById('addDebitButton');
    if(debitBtn) {
        debitBtn.innerHTML = contact.type === 'customer' 
            ? `<i class="fas fa-plus-circle"></i> Tambah Piutang` 
            : `<i class="fas fa-plus-circle"></i> Tambah Hutang`;
    }

    modal.classList.remove('hidden');
}

export function closeLedgerModal() {
    document.getElementById('ledgerModal').classList.add('hidden');
    currentLedgerContactId = null;
}

export function showAddLedgerEntryModal(entryId = null, type = 'debit') {
    editingLedgerEntryId = entryId;
    currentLedgerType = type;
    
    const modal = document.getElementById('addLedgerEntryModal');
    const title = document.getElementById('addLedgerEntryTitle');
    const amountInput = document.getElementById('ledgerAmount');
    const descInput = document.getElementById('ledgerDescription');
    const dateInput = document.getElementById('ledgerDueDate');
    const dateContainer = document.getElementById('ledgerDueDateContainer');
    
    amountInput.value = '';
    descInput.value = '';
    dateInput.value = '';
    
    if (type === 'debit') {
        title.textContent = entryId ? 'Edit Catatan Hutang/Piutang' : 'Tambah Hutang/Piutang';
        dateContainer.style.display = 'block';
    } else {
        title.textContent = entryId ? 'Edit Catatan Pembayaran' : 'Catat Pembayaran';
        dateContainer.style.display = 'none';
    }

    if (entryId) {
        getFromDB('ledgers', entryId).then(l => {
            if(l) {
                amountInput.value = l.amount;
                descInput.value = l.description;
                if(l.dueDate) dateInput.value = l.dueDate.split('T')[0];
            }
        });
    }

    modal.classList.remove('hidden');
}

export function closeAddLedgerEntryModal() {
    document.getElementById('addLedgerEntryModal').classList.add('hidden');
    editingLedgerEntryId = null;
}

export async function saveLedgerEntry() {
    const amount = parseFloat(document.getElementById('ledgerAmount').value);
    const description = document.getElementById('ledgerDescription').value.trim();
    const dueDateVal = document.getElementById('ledgerDueDate').value;
    
    if (isNaN(amount) || amount <= 0) {
        showToast('Jumlah harus lebih dari 0');
        return;
    }
    if (!description) {
        showToast('Keterangan wajib diisi');
        return;
    }

    const entry = {
        contactId: currentLedgerContactId,
        amount,
        description,
        type: currentLedgerType,
        date: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Track who made this entry for Cashier Reporting
        userId: window.app.currentUser ? window.app.currentUser.id : null 
    };
    
    if (currentLedgerType === 'debit' && dueDateVal) {
        entry.dueDate = new Date(dueDateVal).toISOString();
    } else {
        entry.dueDate = null;
    }

    try {
        if (editingLedgerEntryId) {
            entry.id = editingLedgerEntryId;
            const old = await getFromDB('ledgers', editingLedgerEntryId);
            if(old) entry.date = old.date;
        } else {
            entry.createdAt = new Date().toISOString();
        }

        const savedId = await putToDB('ledgers', entry);
        await queueSyncAction(editingLedgerEntryId ? 'UPDATE_LEDGER' : 'CREATE_LEDGER', { ...entry, id: savedId });
        
        showToast('Berhasil disimpan');
        closeAddLedgerEntryModal();
        showLedgerModal(currentLedgerContactId);
        loadContactsPage(); 
        updateDashboardSummaries();
    } catch (e) {
        console.error(e);
        showToast('Gagal menyimpan');
    }
}

export function showLedgerActions(event, entryId, contactId) {
    event.stopPropagation();
    const popover = document.getElementById('ledgerActionsPopover');
    const rect = event.target.getBoundingClientRect();
    popover.style.top = `${rect.bottom + window.scrollY}px`;
    popover.style.left = `${rect.left - 100}px`;
    
    popover.innerHTML = `
        <a onclick="editLedgerEntry(${entryId})" class="text-blue-600"><i class="fas fa-edit mr-2"></i>Edit</a>
        <a onclick="deleteLedgerEntry(${entryId})" class="text-red-600"><i class="fas fa-trash mr-2"></i>Hapus</a>
        <a onclick="showEditDueDateModal(${entryId})" class="text-orange-600"><i class="fas fa-clock mr-2"></i>Atur Jatuh Tempo</a>
    `;
    
    popover.classList.remove('hidden');
    window.app.activePopover = popover;
}

export function closeLedgerActions() {
    const popover = document.getElementById('ledgerActionsPopover');
    if(popover) popover.classList.add('hidden');
    window.app.activePopover = null;
}

export function editLedgerEntry(entryId) {
    getFromDB('ledgers', entryId).then(l => {
        if(l) {
            showAddLedgerEntryModal(entryId, l.type);
            closeLedgerActions();
        }
    });
}

export function deleteLedgerEntry(entryId) {
    closeLedgerActions();
    showConfirmationModal('Hapus Transaksi', 'Yakin menghapus catatan ini?', async () => {
        try {
            const entry = await getFromDB('ledgers', entryId);
            const tx = window.app.db.transaction('ledgers', 'readwrite');
            tx.objectStore('ledgers').delete(entryId);
            tx.oncomplete = async () => {
                await queueSyncAction('DELETE_LEDGER', entry);
                showToast('Dihapus');
                showLedgerModal(currentLedgerContactId);
                loadContactsPage();
                updateDashboardSummaries();
            };
        } catch(e) {
            console.error(e);
        }
    }, 'Ya, Hapus', 'bg-red-500');
}

export function showEditDueDateModal(entryId) {
    closeLedgerActions();
    document.getElementById('editDueDateEntryId').value = entryId;
    getFromDB('ledgers', entryId).then(l => {
        if(l && l.dueDate) {
            document.getElementById('newDueDate').value = l.dueDate.split('T')[0];
        } else {
            document.getElementById('newDueDate').value = '';
        }
    });
    document.getElementById('editDueDateModal').classList.remove('hidden');
}

export function closeEditDueDateModal() {
    document.getElementById('editDueDateModal').classList.add('hidden');
}

export async function saveDueDate() {
    const entryId = parseInt(document.getElementById('editDueDateEntryId').value);
    const dateVal = document.getElementById('newDueDate').value;
    
    if (!entryId) return;
    
    try {
        const entry = await getFromDB('ledgers', entryId);
        if (entry) {
            entry.dueDate = dateVal ? new Date(dateVal).toISOString() : null;
            entry.updatedAt = new Date().toISOString();
            await putToDB('ledgers', entry);
            await queueSyncAction('UPDATE_LEDGER', entry);
            showToast('Jatuh tempo diperbarui');
            closeEditDueDateModal();
            showLedgerModal(currentLedgerContactId);
        }
    } catch (e) {
        console.error(e);
        showToast('Gagal update');
    }
}

export async function checkDueDateNotifications() {
    try {
        const ledgers = await getAllFromDB('ledgers');
        const today = new Date();
        today.setHours(0,0,0,0);
        
        const dueItems = ledgers.filter(l => {
            if (!l.dueDate || l.type !== 'debit') return false;
            const d = new Date(l.dueDate);
            d.setHours(0,0,0,0);
            // Show if due within 3 days or overdue
            const diffDays = (d - today) / (1000 * 60 * 60 * 24);
            return diffDays <= 3; 
        });
        
        const card = document.getElementById('dueDateNotificationCard');
        const countEl = document.getElementById('dueDateCount');
        
        if (dueItems.length > 0) {
            window.app.dueItemsList = dueItems;
            countEl.textContent = dueItems.length;
            card.classList.remove('hidden');
            card.onclick = showDueDateModal;
        } else {
            card.classList.add('hidden');
        }

    } catch (e) {
        console.error("Error checking due dates", e);
    }
}

export async function showDueDateModal() {
    const modal = document.getElementById('dueDateModal');
    const list = document.getElementById('dueDateList');
    const items = window.app.dueItemsList || [];
    
    if (items.length === 0) return;
    
    const contacts = await getAllFromDB('contacts');
    const contactMap = new Map(contacts.map(c => [c.id, c.name]));
    
    list.innerHTML = items.map(item => {
        const name = contactMap.get(item.contactId) || 'Unknown';
        const date = new Date(item.dueDate).toLocaleDateString('id-ID');
        const isOverdue = new Date(item.dueDate) < new Date().setHours(0,0,0,0);
        
        return `
            <div class="card p-3 border ${isOverdue ? 'border-red-300 bg-red-50' : 'border-yellow-300 bg-yellow-50'}">
                <div class="flex justify-between">
                    <h3 class="font-bold">${name}</h3>
                    <span class="text-sm font-semibold">Rp ${formatCurrency(item.amount)}</span>
                </div>
                <p class="text-sm">${item.description}</p>
                <div class="flex justify-between items-center mt-2">
                    <span class="text-xs ${isOverdue ? 'text-red-600 font-bold' : 'text-yellow-700'}">Jatuh Tempo: ${date}</span>
                    <button onclick="viewLedgerFromDueDateModal(${item.contactId})" class="text-blue-600 text-xs underline">Lihat Detail</button>
                </div>
            </div>
        `;
    }).join('');
    
    modal.classList.remove('hidden');
}

export function closeDueDateModal() {
    document.getElementById('dueDateModal').classList.add('hidden');
}

export function viewLedgerFromDueDateModal(contactId) {
    closeDueDateModal();
    showPage('kontak');
    showLedgerModal(contactId);
}
