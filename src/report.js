import { getAllFromDB, getFromDB, putToDB } from './db.js';
import { showToast, showConfirmationModal } from './ui.js';
import { queueSyncAction } from './sync.js';
import { formatCurrency } from './ui.js';

// --- REPORTS ---
export async function generateReport() {
    const dateFrom = (document.getElementById('dateFrom')).value;
    const dateTo = (document.getElementById('dateTo')).value;
    
    if (!dateFrom || !dateTo) {
        showToast('Silakan pilih rentang tanggal.');
        return;
    }
    
    const transactions = await getAllFromDB('transactions');
    const products = await getAllFromDB('products');
    
    const filteredTransactions = transactions.filter(t => {
        const date = t.date.split('T')[0];
        return date >= dateFrom && date <= dateTo;
    });
    
    window.app.currentReportData = filteredTransactions;

    if (filteredTransactions.length === 0) {
        showToast('Tidak ada transaksi ditemukan pada rentang tanggal tersebut.');
        document.getElementById('reportSummary').style.display = 'none';
        document.getElementById('reportDetails').style.display = 'none';
        document.getElementById('topSellingProductsCard').style.display = 'none';
        return;
    }

    displayReportSummary(filteredTransactions, products);
    displayReportDetails(filteredTransactions);
    displayTopSellingProducts(filteredTransactions);

    document.getElementById('reportSummary').style.display = 'block';
    document.getElementById('reportDetails').style.display = 'block';
    document.getElementById('topSellingProductsCard').style.display = 'block';
}

function displayReportSummary(transactions, products) {
    const productMap = new Map(products.map(p => [p.id, p]));

    let omzet = 0;
    let hpp = 0;
    let totalOperationalCost = 0;

    transactions.forEach(t => {
        const subtotalAfterDiscount = t.subtotal - (t.totalDiscount || 0);
        omzet += subtotalAfterDiscount;

        t.items.forEach(item => {
            const product = productMap.get(item.id);
            const purchasePrice = product ? (product.purchasePrice || 0) : 0;
            hpp += purchasePrice * item.quantity;
        });
        
        (t.fees || []).forEach(fee => {
            totalOperationalCost += fee.amount;
        });
    });

    const grossProfit = omzet - hpp;
    const netProfit = grossProfit - totalOperationalCost;
    const cashFlow = grossProfit;
    const totalTransactions = transactions.length;
    const average = totalTransactions > 0 ? omzet / totalTransactions : 0;

    (document.getElementById('reportOmzet')).textContent = `Rp ${formatCurrency(omzet)}`;
    (document.getElementById('reportHpp')).textContent = `Rp ${formatCurrency(hpp)}`;
    (document.getElementById('reportGrossProfit')).textContent = `Rp ${formatCurrency(grossProfit)}`;
    (document.getElementById('reportOperationalCost')).textContent = `Rp ${formatCurrency(totalOperationalCost)}`;
    (document.getElementById('reportNetProfit')).textContent = `Rp ${formatCurrency(netProfit)}`;
    (document.getElementById('reportCashFlow')).textContent = `Rp ${formatCurrency(cashFlow)}`;
    (document.getElementById('reportTotalTransactions')).textContent = totalTransactions.toString();
    (document.getElementById('reportAverage')).textContent = `Rp ${formatCurrency(average)}`;
}

function displayReportDetails(transactions) {
    const detailsEl = document.getElementById('reportTransactions');
    detailsEl.innerHTML = transactions.sort((a,b) => new Date(b.date) - new Date(a.date)).map(t => {
        const date = new Date(t.date);
        const formattedDate = `${date.toLocaleDateString('id-ID')} ${date.toLocaleTimeString('id-ID')}`;
        return `
            <div class="border-t pt-2 mt-2">
                <div class="flex justify-between text-sm">
                    <span>${formattedDate}</span>
                    <span class="font-semibold">Rp ${formatCurrency(t.total)}</span>
                </div>
                 <p class="text-xs text-gray-500">Kasir: ${t.userName || 'N/A'}</p>
                <ul class="text-xs text-gray-600 pl-4 mt-1 space-y-1">
                    ${t.items.map((item, index) => `
                        <li class="flex justify-between items-center">
                            <span>${item.quantity}x ${item.name} &mdash; Rp ${formatCurrency(item.effectivePrice * item.quantity)}</span>
                            <button onclick="returnItem(${t.id}, ${index})" title="Kembalikan item ini" class="text-red-500 hover:text-red-700 clickable text-sm w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-100 transition-colors">
                                <i class="fas fa-undo"></i>
                            </button>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }).join('');
}

export async function returnItem(transactionId, itemIndex) {
    try {
        const transaction = await getFromDB('transactions', transactionId);
        if (!transaction || !transaction.items[itemIndex]) {
            showToast('Item atau transaksi tidak ditemukan.');
            return;
        }

        const item = transaction.items[itemIndex];

        showConfirmationModal(
            'Konfirmasi Pengembalian',
            `Anda yakin ingin mengembalikan <strong>${item.quantity}x ${item.name}</strong> senilai <strong>Rp ${formatCurrency(item.effectivePrice * item.quantity)}</strong>? Stok produk akan dikembalikan dan laporan akan diperbarui.`,
            async () => {
                await processItemReturn(transactionId, itemIndex);
            },
            'Ya, Kembalikan',
            'bg-red-500'
        );
    } catch (error) {
        console.error('Error preparing item return:', error);
        showToast('Gagal memproses pengembalian.');
    }
}

async function processItemReturn(transactionId, itemIndex) {
    try {
        const originalTransaction = await getFromDB('transactions', transactionId);
        const transaction = JSON.parse(JSON.stringify(originalTransaction));

        if (!transaction || !transaction.items[itemIndex]) {
            showToast('Transaksi tidak valid saat proses.');
            return;
        }

        const [returnedItem] = transaction.items.splice(itemIndex, 1);
        if (!returnedItem) {
             showToast('Item tidak ditemukan dalam transaksi.');
             return;
        }
        
        if (transaction.items.length === 0) {
             const tx = window.app.db.transaction('transactions', 'readwrite');
             tx.objectStore('transactions').delete(transactionId);
             await new Promise(resolve => tx.oncomplete = resolve);
             await queueSyncAction('DELETE_TRANSACTION', originalTransaction);
        } else {
            transaction.subtotal = transaction.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            transaction.totalDiscount = transaction.items.reduce((sum, item) => {
                const discountAmount = item.price * ((item.discountPercentage || 0) / 100);
                return sum + (discountAmount * item.quantity);
            }, 0);
            
            const subtotalAfterDiscount = transaction.subtotal - transaction.totalDiscount;
            let totalFeeAmount = 0;

            (transaction.fees || []).forEach(fee => {
                if (fee.type === 'percentage') {
                    fee.amount = subtotalAfterDiscount * (fee.value / 100);
                }
                totalFeeAmount += fee.amount;
            });
            
            transaction.total = subtotalAfterDiscount + totalFeeAmount;
            transaction.change = transaction.cashPaid - transaction.total;
            
            await putToDB('transactions', transaction);
            await queueSyncAction('UPDATE_TRANSACTION', transaction);
        }

        const product = await getFromDB('products', returnedItem.id);
        if (product) {
            product.stock += returnedItem.quantity;
            product.updatedAt = new Date().toISOString();
            await putToDB('products', product);
            await queueSyncAction('UPDATE_PRODUCT', product);
        }

        showToast('Item berhasil dikembalikan.');
        await generateReport();

    } catch (error) {
        console.error('Failed to process item return:', error);
        showToast('Terjadi kesalahan saat mengembalikan item.');
    }
}


function displayTopSellingProducts(transactions) {
    const productSales = {};

    transactions.forEach(t => {
        t.items.forEach(item => {
            if (!productSales[item.name]) {
                productSales[item.name] = { quantity: 0, revenue: 0 };
            }
            productSales[item.name].quantity += item.quantity;
            productSales[item.name].revenue += item.effectivePrice * item.quantity;
        });
    });

    const sortedProducts = Object.entries(productSales)
        .sort(([,a], [,b]) => b.quantity - a.quantity)
        .slice(0, 5);
    
    const listEl = document.getElementById('topSellingProductsList');
    if (sortedProducts.length === 0) {
        listEl.innerHTML = `<p class="text-gray-500 text-center py-2">Tidak ada produk terjual.</p>`;
        return;
    }

    listEl.innerHTML = sortedProducts.map(([name, data], index) => `
        <div class="flex justify-between items-center text-sm">
            <span>${index + 1}. ${name}</span>
            <div class="text-right">
                <span class="font-semibold">${data.quantity} terjual</span>
                <p class="text-xs text-gray-500">Rp ${formatCurrency(data.revenue)}</p>
            </div>
        </div>
    `).join('');
}


export function displaySalesReport(transactions, viewType) {
    if (!window.app.isChartJsReady || !Chart) {
        document.getElementById('salesChartCard').innerHTML = `<p class="text-center text-red-500">Grafik tidak dapat dimuat.</p>`;
        return;
    }
    
    const salesData = {};
    const getWeek = (d) => {
        const date = new Date(d.getTime());
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
        const week1 = new Date(date.getFullYear(), 0, 4);
        return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    };

    transactions.forEach(t => {
        const date = new Date(t.date);
        let key;

        if (viewType === 'daily') {
            key = date.toISOString().split('T')[0];
        } else {
            key = `${date.getFullYear()}-W${getWeek(date)}`;
        }

        if (!salesData[key]) {
            salesData[key] = 0;
        }
        salesData[key] += t.total;
    });

    const sortedLabels = Object.keys(salesData).sort();
    const dataPoints = sortedLabels.map(label => salesData[label]);
    
    const ctx = document.getElementById('salesChart').getContext('2d');
    
    if (window.app.salesChartInstance) {
        window.app.salesChartInstance.destroy();
    }
    
    window.app.salesChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sortedLabels,
            datasets: [{
                label: 'Total Penjualan',
                data: dataPoints,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.3,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value, index, values) {
                            return 'Rp ' + (value / 1000) + 'k';
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}


export function setupChartViewToggle() {
    const dailyBtn = document.getElementById('dailyViewBtn');
    const weeklyBtn = document.getElementById('weeklyViewBtn');
    const glider = document.getElementById('chartViewGlider');

    dailyBtn.addEventListener('click', () => {
        glider.style.transform = 'translateX(0%)';
        dailyBtn.classList.remove('text-gray-500');
        dailyBtn.classList.add('text-gray-800');
        weeklyBtn.classList.add('text-gray-500');
        weeklyBtn.classList.remove('text-gray-800');
        displaySalesReport(window.app.dashboardTransactions, 'daily');
    });

    weeklyBtn.addEventListener('click', () => {
        glider.style.transform = 'translateX(100%)';
        weeklyBtn.classList.remove('text-gray-500');
        weeklyBtn.classList.add('text-gray-800');
        dailyBtn.classList.add('text-gray-500');
        dailyBtn.classList.remove('text-gray-800');
        displaySalesReport(window.app.dashboardTransactions, 'weekly');
    });
}


export async function exportReportToCSV() {
    if (window.app.currentReportData.length === 0) {
        showToast('Tidak ada data untuk diexport.');
        return;
    }

    try {
        const products = await getAllFromDB('products');
        const productMap = new Map(products.map(p => [p.id, p]));

        let omzet = 0;
        let hpp = 0;
        let totalOperationalCost = 0;

        window.app.currentReportData.forEach(t => {
            const subtotalAfterDiscount = t.subtotal - (t.totalDiscount || 0);
            omzet += subtotalAfterDiscount;
            t.items.forEach(item => {
                const product = productMap.get(item.id);
                const purchasePrice = product ? (product.purchasePrice || 0) : 0;
                hpp += purchasePrice * item.quantity;
            });
            (t.fees || []).forEach(fee => {
                totalOperationalCost += fee.amount;
            });
        });

        const grossProfit = omzet - hpp;
        const netProfit = grossProfit - totalOperationalCost;
        const dateFrom = document.getElementById('dateFrom').value;
        const dateTo = document.getElementById('dateTo').value;

        let csvContent = "";

        csvContent += "Ringkasan Laporan\n";
        csvContent += `Periode,"${dateFrom} s/d ${dateTo}"\n`;
        csvContent += "\n";
        csvContent += `Total Omzet (Penjualan Kotor),${omzet}\n`;
        csvContent += `(-) Total Harga Pokok Penjualan (HPP),${hpp}\n`;
        csvContent += `Laba Kotor,${grossProfit}\n`;
        csvContent += `(-) Total Biaya Operasional (Pajak/Biaya),${totalOperationalCost}\n`;
        csvContent += `Laba Bersih,${netProfit}\n`;
        csvContent += "\n\n";

        const header = [
            'ID Transaksi', 'Tanggal', 'Nama Produk', 'Kategori', 'Jumlah',
            'Harga Jual (Satuan)', 'Total Omzet Item', 'Harga Beli (Satuan)',
            'Total HPP Item', 'Laba Item'
        ].join(',');
        csvContent += header + '\n';

        window.app.currentReportData.forEach(t => {
            const transactionDate = new Date(t.date).toLocaleString('id-ID');
            t.items.forEach(item => {
                const product = productMap.get(item.id);
                const category = product ? product.category : 'N/A';
                const purchasePrice = product ? (product.purchasePrice || 0) : 0;

                const totalOmzetItem = item.effectivePrice * item.quantity;
                const totalHppItem = purchasePrice * item.quantity;
                const labaItem = totalOmzetItem - totalHppItem;

                const escapeCSV = (val) => {
                    if (val === null || val === undefined) return '';
                    let str = String(val);
                    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                        return `"${str.replace(/"/g, '""')}"`;
                    }
                    return str;
                };

                const row = [
                    t.id,
                    transactionDate,
                    item.name,
                    category,
                    item.quantity,
                    item.effectivePrice,
                    totalOmzetItem,
                    purchasePrice,
                    totalHppItem,
                    labaItem
                ].map(escapeCSV).join(',');
                
                csvContent += row + '\n';
            });
        });
        
        const fileName = `laporan_penjualan_rinci_${dateFrom}_sd_${dateTo}.csv`;

        if (window.AndroidDownloader) {
            window.AndroidDownloader.downloadFile(csvContent, fileName, 'text/csv');
        } else {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", fileName);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
        showToast('Export laporan berhasil.');
    } catch (error) {
        console.error('Export report failed:', error);
        showToast('Gagal mengekspor laporan.');
    }
}