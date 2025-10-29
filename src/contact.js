import { getAllFromDB, getFromDB, putToDB } from './db.js';
import { showToast, showConfirmationModal, showPage } from './ui.js';
import { queueSyncAction } from './sync.js';
import { formatCurrency } from './ui.js';

let currentContactTab = 'customer';

// --- SANITIZATION HELPERS ---
function sanitizeContact(contact) {
    if (!contact) return null;
    return {
        id: contact.id,
        serverId: contact.serverId,
        name: contact.name,
        phone: contact.phone,
        address: contact.address,
        notes: contact.notes,
        type: contact.type,
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
    };
}

function sanitizeLedgerEntry(entry) {
    if (!entry) return null;
    return {
        id: entry.id,
        serverId: entry.serverId,
        contactId: entry.contactId,
        amount: entry.amount,
        description: entry.description,
        type: entry.type,
        dueDate: entry.dueDate,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
    };
}


export function switchContactTab(tabName) {
    if (currentContactTab === tabName) return;

    currentContactTab = tabName;
    const customerTab = document.getElementById('customerTab');
    const supplierTab = document.getElementById('supplierTab');
    const customerListContainer = document.getElementById('customerListContainer');
    const supplierListContainer = document.getElementById('supplierListContainer');

    if (tabName === 'customer') {
        customerTab.classList.add('active');
        supplierTab.classList.remove('active');
        customerListContainer.classList.remove('hidden');
        supplierListContainer.classList.add('hidden');
        loadContacts('customer');
    } else {
        supplierTab.classList.add('active');
        customerTab.classList.remove('active');
        supplierListContainer.classList.remove('hidden');
        customerListContainer.classList.add('hidden');
        loadContacts('supplier');
    }
}

async function loadContacts(type) {
    const listElId = type === 'customer' ? 'customerList' : 'supplierList';
    const listEl = document.getElementById(listElId);
    
    const contacts = await getAllFromDB('contacts', 'type', type);
    const ledgers = await getAllFromDB('ledgers');
    
    const balanceMap = new Map();
    ledgers.forEach(entry => {
        const currentBalance = balanceMap.get(entry.contactId) || 0;
        const amount = entry.type === 'debit' ? entry.amount : -entry.amount;
        balanceMap.set(entry.contactId, currentBalance + amount);
    });

    if (contacts.length === 0) {
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
        return;
    }
    
    listEl.innerHTML = contacts.sort((a,b) => a.name.localeCompare(b.name)).map(contact => {
        const balance = balanceMap.get(contact.id) || 0;
        let balanceHtml = '';
        if (balance > 0) {
            const balanceColor = type === 'customer' ? 'text-teal-600' : 'text-red-600';
            const balanceLabel = type === 'customer' ? 'Piutang' : 'Hutang';
            balanceHtml = `<p class="text-sm font-semibold ${balanceColor}">${balanceLabel}: Rp ${formatCurrency(balance)}</p>`;
        } else {
            balanceHtml = `<p class="text-sm text-green-600">Lunas</p>`;
        }

        return `
            <div class="card p-4 clickable" onclick="showLedgerModal(${contact.id})">
                <div class="flex justify-between items-start">
                    <div>
                        <h3 class="font-semibold text-lg">${contact.name}</h3>
                        <p class="text-sm text-gray-500"><i class="fas fa-phone mr-2"></i>${contact.phone || '-'}</p>
                    </div>
                    <div class="text-right">
                         ${balanceHtml}
                    </div>
                </div>
                <div class="flex justify-end gap-2 mt-2 pt-2 border-t">
                    <button onclick="event.stopPropagation(); showContactModal(${contact.id})" class="btn bg-blue-100 text-blue-700 px-3 py-1 text-xs">Edit</button>
                    <button onclick="event.stopPropagation(); deleteContact(${contact.id})" class="btn bg-red-100 text-red-700 px-3 py-1 text-xs">Hapus</button>
                </div>
            </div>
        `;
    }).join('');
}

export function loadContactsPage(initialTab = 'customer') {
    switchContactTab(initialTab);
}

export async function showContactModal(contactId = null) {
    const modal = document.getElementById('contactModal');
    const title = document.getElementById('contactModalTitle');
    const idInput = document.getElementById('contactId');
    const nameInput = document.getElementById('contactName');
    const phoneInput = document.getElementById('contactPhone');
    const addressInput = document.getElementById('contactAddress');
    const notesInput = document.getElementById('contactNotes');
    const typeInput = document.getElementById('contactType');

    // Reset form
    idInput.value = '';
    nameInput.value = '';
    phoneInput.value = '';
    addressInput.value = '';
    notesInput.value = '';
    typeInput.value = currentContactTab;

    if (contactId) {
        title.textContent = 'Edit Kontak';
        const contact = await getFromDB('contacts', contactId);
        if (contact) {
            idInput.value = contact.id;
            nameInput.value = contact.name;
            phoneInput.value = contact.phone || '';
            addressInput.value = contact.address || '';
            notesInput.value = contact.notes || '';
            typeInput.value = contact.type;
        }
    } else {
        title.textContent = 'Tambah Kontak';
    }

    modal.classList.remove('hidden');
}

export function closeContactModal() {
    document.getElementById('contactModal').classList.add('hidden');
}

export async function saveContact() {
    const id = document.getElementById('contactId').value ? parseInt(document.getElementById('contactId').value) : null;
    const name = document.getElementById('contactName').value.trim();
    const phone = document.getElementById('contactPhone').value.trim();
    const address = document.getElementById('contactAddress').value.trim();
    const notes = document.getElementById('contactNotes').value.trim();
    const type = document.getElementById('contactType').value;

    if (!name) {
        showToast('Nama kontak tidak boleh kosong.');
        return;
    }

    const contactData = {
        name,
        phone,
        address,
        notes,
        type,
        updatedAt: new Date().toISOString()
    };
    
    let action = '';
    if (id) {
        contactData.id = id;
        action = 'UPDATE_CONTACT';
    } else {
        contactData.createdAt = new Date().toISOString();
        action = 'CREATE_CONTACT';
    }
    
    try {
        const savedId = await putToDB('contacts', contactData);
        const syncPayload = id ? contactData : { ...contactData, id: savedId };
        await queueSyncAction(action, syncPayload);
        showToast(`Kontak berhasil ${id ? 'diperbarui' : 'disimpan'}.`);
        closeContactModal();
        loadContacts(type); // Refresh the list for the current tab
    } catch (error) {
        console.error('Failed to save contact:', error);
        showToast('Gagal menyimpan kontak.');
    }
}

export async function deleteContact(contactId) {
    const ledgers = await getAllFromDB('ledgers', 'contactId', contactId);
    if (ledgers.length > 0) {
        showToast('Kontak tidak dapat dihapus karena memiliki riwayat transaksi.');
        return;
    }

    showConfirmationModal('Hapus Kontak', 'Yakin ingin menghapus kontak ini?', async () => {
        try {
            const contactToDelete = await getFromDB('contacts', contactId);
            const tx = window.app.db.transaction('contacts', 'readwrite');
            tx.objectStore('contacts').delete(contactId);
            tx.oncomplete = async () => {
                await queueSyncAction('DELETE_CONTACT', sanitizeContact(contactToDelete));
                showToast('Kontak berhasil dihapus.');
                loadContacts(contactToDelete.type);
            };
        } catch (error) {
            console.error('Failed to delete contact:', error);
            showToast('Gagal menghapus kontak.');
        }
    }, 'Ya, Hapus', 'bg-red-500');
}

export async function showLedgerModal(contactId) {
    window.app.currentContactId = contactId;
    const modal = document.getElementById('ledgerModal');
    const nameEl = document.getElementById('ledgerContactName');
    const typeEl = document.getElementById('ledgerContactType');
    const detailsEl = document.getElementById('ledgerContactDetails');
    const addDebitBtn = document.getElementById('addDebitButton');

    const contact = await getFromDB('contacts', contactId);
    if (!contact) {
        showToast('Kontak tidak ditemukan.');
        return;
    }

    nameEl.textContent = contact.name;
    const isCustomer = contact.type === 'customer';
    typeEl.textContent = isCustomer ? 'Pelanggan' : 'Supplier';
    typeEl.className = `text-sm font-semibold ${isCustomer ? 'text-teal-600' : 'text-red-600'}`;
    addDebitBtn.innerHTML = `<i class="fas fa-minus-circle"></i> Tambah ${isCustomer ? 'Piutang' : 'Hutang'}`;
    
    let contactDetailsHtml = '';
    if (contact.phone) contactDetailsHtml += `<p><i class="fas fa-phone fa-fw mr-2"></i>${contact.phone}</p>`;
    if (contact.address) contactDetailsHtml += `<p><i class="fas fa-map-marker-alt fa-fw mr-2"></i>${contact.address}</p>`;
    if (contact.notes) contactDetailsHtml += `<p><i class="fas fa-sticky-note fa-fw mr-2"></i>${contact.notes}</p>`;
    detailsEl.innerHTML = contactDetailsHtml || '<p>Tidak ada detail tambahan.</p>';

    await renderLedgerHistory(contactId);
    modal.classList.remove('hidden');
}

async function renderLedgerHistory(contactId) {
    const historyEl = document.getElementById('ledgerHistory');
    const ledgers = await getAllFromDB('ledgers', 'contactId', contactId);
    ledgers.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    let balance = 0;
    const historyWithBalance = ledgers.map(entry => {
        const amount = entry.type === 'debit' ? entry.amount : -entry.amount;
        const entryWithBalance = { ...entry, balance: balance + amount };
        balance += amount;
        return entryWithBalance;
    }).reverse(); // now chronological

    historyEl.innerHTML = historyWithBalance.reverse().map(entry => {
        const isDebit = entry.type === 'debit';
        const amountColor = isDebit ? 'text-red-500' : 'text-green-500';
        const amountSign = isDebit ? '+' : '-';
        const date = new Date(entry.createdAt).toLocaleDateString('id-ID', {day: 'numeric', month: 'short', year: 'numeric'});

        let dueDateHtml = '';
        if (entry.dueDate) {
            const dueDate = new Date(entry.dueDate);
            const today = new Date(); today.setHours(0,0,0,0);
            let color = 'text-gray-500';
            if (dueDate < today) color = 'text-red-500 font-bold';
            else if (dueDate.getTime() === today.getTime()) color = 'text-orange-500 font-bold';
            dueDateHtml = `<p class="text-xs ${color} mt-1"><i class="fas fa-calendar-alt mr-1"></i>Jatuh tempo: ${dueDate.toLocaleDateString('id-ID')}</p>`;
        }

        return `
            <div class="border-b last:border-b-0 py-3 relative group">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="font-semibold">${entry.description}</p>
                        <p class="text-xs text-gray-500">${date}</p>
                    </div>
                    <div class="text-right">
                        <p class="font-bold text-lg ${amountColor}">${amountSign}Rp ${formatCurrency(entry.amount)}</p>
                        <p class="text-xs text-gray-500">Saldo: Rp ${formatCurrency(entry.balance)}</p>
                    </div>
                </div>
                ${dueDateHtml}
                <div class="absolute top-2 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="showLedgerActions(event, ${entry.id})" class="text-gray-500 hover:text-gray-700 p-1 rounded-full bg-gray-100"><i class="fas fa-ellipsis-v"></i></button>
                </div>
            </div>
        `;
    }).join('');

    if (historyWithBalance.length === 0) {
        historyEl.innerHTML = `<p class="text-gray-500 text-center py-4">Belum ada riwayat transaksi.</p>`;
    }
}

export function closeLedgerModal() {
    document.getElementById('ledgerModal').classList.add('hidden');
    window.app.currentContactId = null;
}

export function showAddLedgerEntryModal(entryId = null, type = 'credit') {
    const modal = document.getElementById('addLedgerEntryModal');
    const titleEl = document.getElementById('addLedgerEntryTitle');
    const amountInput = document.getElementById('ledgerAmount');
    const descInput = document.getElementById('ledgerDescription');
    const dueDateContainer = document.getElementById('ledgerDueDateContainer');
    const dueDateInput = document.getElementById('ledgerDueDate');
    
    window.currentLedgerEntryId = entryId; 
    window.currentLedgerEntryType = type;

    amountInput.value = '';
    descInput.value = '';
    dueDateInput.value = '';

    if (entryId) { // Editing existing entry
        titleEl.textContent = 'Edit Catatan';
        getFromDB('ledgers', entryId).then(entry => {
            if (entry) {
                amountInput.value = entry.amount;
                descInput.value = entry.description;
                dueDateInput.value = entry.dueDate || '';
                window.currentLedgerEntryType = entry.type; // override type
                dueDateContainer.style.display = entry.type === 'debit' ? 'block' : 'none';
            }
        });
    } else { // Adding new entry
        if (type === 'credit') {
            titleEl.textContent = 'Catat Pembayaran';
            dueDateContainer.style.display = 'none';
        } else {
            const contactType = document.getElementById('ledgerContactType').textContent.toLowerCase();
            titleEl.textContent = contactType === 'pelanggan' ? 'Tambah Piutang' : 'Tambah Hutang';
            dueDateContainer.style.display = 'block';
        }
    }
    modal.classList.remove('hidden');
};


export function closeAddLedgerEntryModal() {
    document.getElementById('addLedgerEntryModal').classList.add('hidden');
};

export async function saveLedgerEntry() {
    const amount = parseFloat(document.getElementById('ledgerAmount').value);
    const description = document.getElementById('ledgerDescription').value.trim();
    const dueDate = document.getElementById('ledgerDueDate').value;

    if (isNaN(amount) || amount <= 0 || !description) {
        showToast('Jumlah dan Keterangan harus diisi dengan benar.');
        return;
    }

    const entryData = {
        contactId: window.app.currentContactId,
        amount,
        description,
        type: window.currentLedgerEntryType,
        updatedAt: new Date().toISOString()
    };
    
    if (window.currentLedgerEntryType === 'debit' && dueDate) {
        entryData.dueDate = dueDate;
    }

    let action = '';
    if (window.currentLedgerEntryId) { // Editing
        entryData.id = window.currentLedgerEntryId;
        const existingEntry = await getFromDB('ledgers', window.currentLedgerEntryId);
        entryData.createdAt = existingEntry.createdAt; // preserve original creation date
        action = 'UPDATE_LEDGER_ENTRY';
    } else { // Creating
        entryData.createdAt = new Date().toISOString();
        action = 'CREATE_LEDGER_ENTRY';
    }
    
    try {
        const savedId = await putToDB('ledgers', entryData);
        const syncPayload = window.currentLedgerEntryId ? entryData : { ...entryData, id: savedId };
        await queueSyncAction(action, syncPayload);
        showToast(`Catatan berhasil ${window.currentLedgerEntryId ? 'diperbarui' : 'disimpan'}.`);
        closeAddLedgerEntryModal();
        await renderLedgerHistory(window.app.currentContactId);
        await window.updateDashboardSummaries();
        await checkDueDateNotifications();
    } catch(error) {
        console.error('Failed to save ledger entry:', error);
        showToast('Gagal menyimpan catatan.');
    }
};

export function showLedgerActions(event, entryId) {
    event.stopPropagation();
    const popover = document.getElementById('ledgerActionsPopover');
    
    if (window.app.activePopover && window.app.activePopover !== popover) {
        window.app.activePopover.classList.add('hidden');
    }

    popover.innerHTML = `
        <a onclick="editLedgerEntry(${entryId})"><i class="fas fa-edit fa-fw mr-2"></i>Edit</a>
        <a onclick="showEditDueDateModal(${entryId})" id="editDueDateAction"><i class="fas fa-calendar-alt fa-fw mr-2"></i>Ubah Jatuh Tempo</a>
        <a onclick="deleteLedgerEntry(${entryId})" class="text-red-600"><i class="fas fa-trash fa-fw mr-2"></i>Hapus</a>
    `;

    getFromDB('ledgers', entryId).then(entry => {
        const editDueDateAction = document.getElementById('editDueDateAction');
        if (entry && entry.type === 'debit') {
            editDueDateAction.style.display = 'block';
        } else {
            editDueDateAction.style.display = 'none';
        }
    });

    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    popover.style.top = `${rect.bottom + window.scrollY}px`;
    popover.style.right = `${window.innerWidth - rect.right}px`;
    popover.classList.toggle('hidden');
    window.app.activePopover = popover;
}

export function closeLedgerActions() {
    if (window.app.activePopover) {
        window.app.activePopover.classList.add('hidden');
        window.app.activePopover = null;
    }
}

export function editLedgerEntry(entryId) {
    closeLedgerActions();
    showAddLedgerEntryModal(entryId);
};

export function deleteLedgerEntry(entryId) {
    closeLedgerActions();
    showConfirmationModal('Hapus Catatan', 'Yakin ingin menghapus catatan ini?', async () => {
        try {
            const entryToDelete = await getFromDB('ledgers', entryId);
            const tx = window.app.db.transaction('ledgers', 'readwrite');
            tx.objectStore('ledgers').delete(entryId);
            tx.oncomplete = async () => {
                await queueSyncAction('DELETE_LEDGER_ENTRY', sanitizeLedgerEntry(entryToDelete));
                showToast('Catatan berhasil dihapus.');
                await renderLedgerHistory(window.app.currentContactId);
                await window.updateDashboardSummaries();
                await checkDueDateNotifications();
            };
        } catch (error) {
            console.error('Failed to delete ledger entry:', error);
            showToast('Gagal menghapus catatan.');
        }
    }, 'Ya, Hapus', 'bg-red-500');
};


export function showEditDueDateModal(entryId) {
    closeLedgerActions();
    const modal = document.getElementById('editDueDateModal');
    const entryIdInput = document.getElementById('editDueDateEntryId');
    const newDateInput = document.getElementById('newDueDate');
    
    entryIdInput.value = entryId;
    getFromDB('ledgers', entryId).then(entry => {
        if (entry && entry.dueDate) {
            newDateInput.value = entry.dueDate;
        } else {
            newDateInput.value = '';
        }
    });

    modal.classList.remove('hidden');
};

export function closeEditDueDateModal() {
    const modal = document.getElementById('editDueDateModal');
    if (modal) modal.classList.add('hidden');
};

export async function saveDueDate() {
    const entryId = parseInt(document.getElementById('editDueDateEntryId').value);
    const newDueDate = document.getElementById('newDueDate').value;

    if (!entryId || !newDueDate) {
        showToast('Tanggal jatuh tempo tidak valid.');
        return;
    }

    try {
        const entry = await getFromDB('ledgers', entryId);
        if (entry) {
            entry.dueDate = newDueDate;
            entry.updatedAt = new Date().toISOString();
            
            await putToDB('ledgers', entry);
            await queueSyncAction('UPDATE_LEDGER_ENTRY', sanitizeLedgerEntry(entry));
            
            showToast('Tanggal jatuh tempo berhasil diperbarui.');
            closeEditDueDateModal();
            
            if (window.app.currentContactId) {
                await renderLedgerHistory(window.app.currentContactId);
            }
            await checkDueDateNotifications();
        }
    } catch (error) {
        console.error('Failed to save due date:', error);
        showToast('Gagal menyimpan tanggal jatuh tempo.');
    }
};

export async function checkDueDateNotifications() {
    const notificationCard = document.getElementById('dueDateNotificationCard');
    const countEl = document.getElementById('dueDateCount');
    if (!notificationCard || !countEl) return;

    try {
        const ledgers = await getAllFromDB('ledgers');
        const contacts = await getAllFromDB('contacts');
        const contactsMap = new Map(contacts.map(c => [c.id, c]));

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const threeDaysFromNow = new Date();
        threeDaysFromNow.setDate(today.getDate() + 3);
        threeDaysFromNow.setHours(23, 59, 59, 999);

        const balanceMap = new Map();
        ledgers.forEach(entry => {
             const currentBalance = balanceMap.get(entry.contactId) || 0;
             const amount = entry.type === 'debit' ? entry.amount : -entry.amount;
             balanceMap.set(entry.contactId, currentBalance + amount);
        });

        const dueContactIds = new Set();
        ledgers.forEach(entry => {
             if (entry.type === 'debit' && entry.dueDate) {
                const dueDate = new Date(entry.dueDate);
                if (dueDate <= threeDaysFromNow) {
                    const balance = balanceMap.get(entry.contactId) || 0;
                    if (balance > 0) {
                        dueContactIds.add(entry.contactId);
                    }
                }
            }
        });

        window.app.dueItemsList = ledgers
            .filter(entry => dueContactIds.has(entry.contactId) && entry.type === 'debit' && entry.dueDate)
            .map(entry => {
                const contact = contactsMap.get(entry.contactId);
                return { ...entry, contactName: contact ? contact.name : 'N/A', contactType: contact ? contact.type : 'N/A' };
            })
            .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));


        if (window.app.dueItemsList.length > 0) {
            countEl.textContent = window.app.dueItemsList.length;
            notificationCard.classList.remove('hidden');
            notificationCard.onclick = () => showDueDateModal();
        } else {
            notificationCard.classList.add('hidden');
        }

    } catch (error) {
        console.error("Error checking for due dates:", error);
        notificationCard.classList.add('hidden');
    }
}

export function showDueDateModal() {
    const modal = document.getElementById('dueDateModal');
    const listEl = document.getElementById('dueDateList');
    if (!modal || !listEl) return;

    if (window.app.dueItemsList.length === 0) {
        listEl.innerHTML = `<p class="text-gray-500 text-center py-4">Tidak ada item yang jatuh tempo.</p>`;
    } else {
        listEl.innerHTML = window.app.dueItemsList.map(item => {
            const dueDate = new Date(item.dueDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let dueDateText;
            let textColor = 'text-gray-600';
            if (dueDate < today) {
                dueDateText = 'Terlambat';
                textColor = 'text-red-500 font-bold';
            } else if (dueDate.toDateString() === today.toDateString()) {
                dueDateText = 'Hari Ini';
                textColor = 'text-orange-500 font-bold';
            } else {
                dueDateText = dueDate.toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'});
            }

            const debtOrReceivable = item.contactType === 'customer' ? 'Piutang' : 'Hutang';

            return `
            <div class="border-b pb-3">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="font-semibold">${item.contactName}</p>
                        <p class="text-sm text-gray-500">${debtOrReceivable}: ${item.description}</p>
                    </div>
                    <p class="font-bold text-lg text-gray-800">Rp ${formatCurrency(item.amount)}</p>
                </div>
                <div class="flex justify-between items-center mt-2">
                    <p class="text-sm ${textColor}">Jatuh Tempo: ${dueDateText}</p>
                    <button class="btn bg-blue-500 text-white px-3 py-1 text-xs" onclick="viewLedgerFromDueDateModal(${item.contactId})">
                        Lihat Buku Besar
                    </button>
                </div>
            </div>
            `;
        }).join('');
    }

    modal.classList.remove('hidden');
}

export function closeDueDateModal() {
    const modal = document.getElementById('dueDateModal');
    if (modal) modal.classList.add('hidden');
}

export function viewLedgerFromDueDateModal(contactId) {
    closeDueDateModal();
    showPage('kontak');
    setTimeout(() => showLedgerModal(contactId), 350);
}