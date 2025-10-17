import { getSettingFromDB, getAllFromDB } from "./db.js";
import { showToast, showConfirmationModal } from "./ui.js";
import { addToCart } from "./cart.js";

// --- CAMERA FUNCTIONS ---
export async function openCameraModal() {
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('cameraFeed');
    const photoPreview = document.getElementById('photoPreview');
    const errorEl = document.getElementById('cameraError');
    const captureBtn = document.getElementById('captureBtn');
    const retakeBtn = document.getElementById('retakeBtn');
    const usePhotoBtn = document.getElementById('usePhotoBtn');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        errorEl.textContent = 'Kamera tidak didukung oleh browser ini.';
        errorEl.style.display = 'block';
        video.style.display = 'none';
        captureBtn.style.display = 'none';
        modal.classList.remove('hidden');
        return;
    }
    
    // Reset UI
    errorEl.style.display = 'none';
    video.style.display = 'block';
    photoPreview.style.display = 'none';
    captureBtn.style.display = 'flex';
    retakeBtn.style.display = 'none';
    usePhotoBtn.style.display = 'none';

    modal.classList.remove('hidden');

    try {
        const constraints = { video: { facingMode: "environment" } };
        window.app.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = window.app.cameraStream;
        await video.play();
    } catch (err) {
        console.error("Error accessing camera:", err);
        errorEl.textContent = 'Gagal mengakses kamera. Pastikan izin telah diberikan.';
        errorEl.style.display = 'block';
        video.style.display = 'none';
        captureBtn.style.display = 'none';
    }
}

export function closeCameraModal() {
    if (window.app.cameraStream) {
        window.app.cameraStream.getTracks().forEach(track => track.stop());
        window.app.cameraStream = null;
    }
    const video = document.getElementById('cameraFeed');
    if (video) video.srcObject = null;
    document.getElementById('cameraModal').classList.add('hidden');
}

export function capturePhoto() {
    const video = document.getElementById('cameraFeed');
    const canvas = document.getElementById('cameraCanvas');
    const photoPreview = document.getElementById('photoPreview');
    const captureBtn = document.getElementById('captureBtn');
    const retakeBtn = document.getElementById('retakeBtn');
    const usePhotoBtn = document.getElementById('usePhotoBtn');
    const context = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    photoPreview.src = canvas.toDataURL('image/jpeg');
    photoPreview.style.display = 'block';
    video.style.display = 'none';

    captureBtn.style.display = 'none';
    retakeBtn.style.display = 'block';
    usePhotoBtn.style.display = 'block';
}

export function retakePhoto() {
    const video = document.getElementById('cameraFeed');
    const photoPreview = document.getElementById('photoPreview');
    const captureBtn = document.getElementById('captureBtn');
    const retakeBtn = document.getElementById('retakeBtn');
    const usePhotoBtn = document.getElementById('usePhotoBtn');

    photoPreview.style.display = 'none';
    video.style.display = 'block';

    captureBtn.style.display = 'flex';
    retakeBtn.style.display = 'none';
    usePhotoBtn.style.display = 'none';
}

export function useCapturedPhoto() {
    const canvas = document.getElementById('cameraCanvas');
    const activeModal = document.getElementById('addProductModal').classList.contains('hidden') ? 'edit' : 'add';

    if (activeModal === 'add') {
        window.app.currentImageData = canvas.toDataURL('image/jpeg');
        document.getElementById('imagePreview').innerHTML = `<img src="${window.app.currentImageData}" alt="Preview" class="image-preview">`;
    } else {
        window.app.currentEditImageData = canvas.toDataURL('image/jpeg');
        document.getElementById('editImagePreview').innerHTML = `<img src="${window.app.currentEditImageData}" alt="Preview" class="image-preview">`;
    }
    
    closeCameraModal();
}

// --- BARCODE SCANNING ---

function startScanner() {
    if (!window.app.isScannerReady || !Html5Qrcode) {
        console.warn('Scanner library not ready.');
        return;
    }
    
    const onScanSuccess = async (decodedText, decodedResult) => {
        if (window.app.html5QrCode.isScanning) {
            await window.app.html5QrCode.stop();
        }

        if (window.app.scanCallback) {
            window.app.scanCallback(decodedText);
            return;
        }

        const products = await getAllFromDB('products');
        const product = products.find(p => p.barcode === decodedText);

        if (product) {
            addToCart(product.id);
            closeScanModal();
        } else {
            showToast(`Produk dengan barcode ${decodedText} tidak ditemukan.`);
            setTimeout(() => {
                if (document.getElementById('scanModal').classList.contains('hidden') === false) {
                     window.app.html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, (errorMessage) => {});
                }
            }, 2000);
        }
    };
    
    const onScanFailure = (error) => {};
    
    window.app.html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, onScanFailure)
      .catch((err) => {
        showToast('Gagal memulai kamera. Pastikan izin telah diberikan.');
        console.error("Failed to start QR code reader:", err);
      });
}

export function showScanModal() {
    if (!window.app.isScannerReady) {
        showToast('Pemindai barcode gagal dimuat.');
        return;
    }
    (document.getElementById('scanModal')).classList.remove('hidden');
    startScanner();
}

export function scanBarcodeForInput(targetInputId) {
    window.app.scanCallback = (decodedText) => {
        const inputEl = document.getElementById(targetInputId);
        if (inputEl) {
            inputEl.value = decodedText;
        }
        closeScanModal();
    };
    showScanModal();
};


export async function closeScanModal() {
    const modal = document.getElementById('scanModal');
    if (modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
        if (window.app.html5QrCode && window.app.html5QrCode.isScanning) {
            try {
                await window.app.html5QrCode.stop();
            } catch (err) {
                console.error("Error stopping scanner:", err);
            }
        }
    }
    window.app.scanCallback = null;
}


// --- RECEIPT PRINTING ---

function sendToRawBT(data) {
    let binary = '';
    const len = data.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(data[i]);
    }
    const base64 = btoa(binary);
    const intentUrl = `rawbt:base64,${base64}`;
    window.location.href = intentUrl;
};

async function _generateReceiptText(transactionData, isPreview) {
    const settings = await getAllFromDB('settings');
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));

    const storeName = settingsMap.get('storeName') || 'Toko Anda';
    const storeAddress = settingsMap.get('storeAddress') || '';
    const feedbackPhone = settingsMap.get('storeFeedbackPhone') || '';
    const footerText = settingsMap.get('storeFooterText') || 'Terima kasih!';
    const paperSize = settingsMap.get('printerPaperSize') || '80mm';
    const paperWidthChars = paperSize === '58mm' ? 32 : 42;

    const receiptLine = (char) => char.repeat(paperWidthChars);
    const formatLine = (left, right) => {
        const spaces = Math.max(0, paperWidthChars - left.length - right.length);
        return left + ' '.repeat(spaces) + right;
    };
    const centerText = (text) => {
        if (!text) return ''.padStart(paperWidthChars, ' ');
        const textLines = text.split('\n');
        return textLines.map(line => {
            const padding = Math.max(0, paperWidthChars - line.length);
            const leftPad = Math.floor(padding / 2);
            return ' '.repeat(leftPad) + line;
        }).join('\n');
    };

    let receiptText = "";

    if (storeName) receiptText += centerText(storeName) + '\n';
    if (storeAddress) receiptText += centerText(storeAddress) + '\n';
    receiptText += receiptLine('=') + '\n';
    receiptText += '\n';
    receiptText += `No: ${transactionData.id || (isPreview ? 'PREVIEW' : 'N/A')}\n`;
    receiptText += `Tgl: ${window.formatReceiptDate(transactionData.date)}\n`;
    receiptText += receiptLine('-') + '\n';

    transactionData.items.forEach(item => {
        receiptText += `${item.name} x${item.quantity}\n`;
        const totalItemPriceText = `Rp.${window.formatCurrency(item.effectivePrice * item.quantity)}`;
        let priceDetailText;
        if (item.discountPercentage > 0) {
            priceDetailText = `@ Rp.${window.formatCurrency(item.price)} Disc ${item.discountPercentage}%`;
        } else {
             priceDetailText = `@ Rp.${window.formatCurrency(item.price)}`;
        }
        receiptText += formatLine(priceDetailText, totalItemPriceText) + '\n';
    });
    
    const subtotalAfterDiscount = transactionData.items.reduce((sum, item) => {
        const priceToUse = item.effectivePrice !== undefined ? item.effectivePrice : (item.price * (1 - (item.discountPercentage || 0) / 100));
        return sum + Math.round(priceToUse * item.quantity);
    }, 0);

    receiptText += receiptLine('-') + '\n';
    receiptText += formatLine('Subtotal', `Rp.${window.formatCurrency(subtotalAfterDiscount)}`) + '\n';
    
    if (transactionData.fees && transactionData.fees.length > 0) {
        transactionData.fees.forEach(fee => {
            let feeName = fee.name;
             if (fee.type === 'percentage') {
                feeName += ` ${fee.value}%`;
            }
            const feeAmount = `Rp. ${window.formatCurrency(fee.amount)}`;
            receiptText += formatLine(feeName, feeAmount) + '\n';
        });
    }
    
    receiptText += receiptLine('-') + '\n';
    receiptText += formatLine('TOTAL', `Rp.${window.formatCurrency(transactionData.total)}`) + '\n';
    receiptText += formatLine('TUNAI', `Rp.${window.formatCurrency(transactionData.cashPaid)}`) + '\n';
    receiptText += formatLine('KEMBALI', `Rp. ${window.formatCurrency(transactionData.change)}`) + '\n';

    receiptText += receiptLine('=') + '\n';
    if (footerText) {
        receiptText += centerText(footerText) + '\n';
    }
    if (feedbackPhone) {
        receiptText += centerText(`Kritik/Saran: ${feedbackPhone}`) + '\n';
    }

    return receiptText;
}

async function _generateReceiptHTML(data, isPreview) {
    const settings = await getAllFromDB('settings');
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));
    const logoData = settingsMap.get('storeLogo') || null;
    const showLogo = settingsMap.get('showLogoOnReceipt') !== false;

    let receiptText = await _generateReceiptText(data, isPreview);

    const logoHtml = showLogo && logoData 
        ? `<div id="receiptLogoContainer" style="text-align: center; margin-bottom: 2px;"><img src="${logoData}" alt="Logo" style="max-width: 150px; max-height: 75px; margin: 0 auto;"></div>` 
        : '';
        
    const pre = document.createElement('pre');
    pre.textContent = receiptText;
    
    pre.innerHTML = pre.innerHTML.replace(
        /^(TOTAL\s+Rp\..*)$/m,
        `<b>$1</b>`
    );

    return logoHtml + pre.outerHTML;
}

async function generateReceiptEscPos(transactionData) {
    if (!window.app.isPrinterReady) {
        throw new Error('Printer library not loaded.');
    }

    const settings = await getAllFromDB('settings');
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));
    const logoData = settingsMap.get('storeLogo') || null;
    const showLogo = settingsMap.get('showLogoOnReceipt') !== false;
    const paperSize = settingsMap.get('printerPaperSize') || '80mm';

    const encoder = new EscPosEncoder.default();
    encoder
        .initialize()
        .raw([0x1b, 0x40]);


    const receiptText = await _generateReceiptText(transactionData, false);
    encoder.align('left');

    if (showLogo && logoData) {
        try {
            const image = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = logoData;
            });

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            const maxWidth = paperSize === '58mm' ? 200 : 300;
            const maxHeight = paperSize === '58mm' ? 80 : 100;
            let imgWidth = image.width;
            let imgHeight = image.height;

            const widthRatio = maxWidth / imgWidth;
            const heightRatio = maxHeight / imgHeight;
            const scaleRatio = Math.min(widthRatio, heightRatio, 1);

            imgWidth *= scaleRatio;
            imgHeight *= scaleRatio;

            canvas.width = imgWidth;
            canvas.height = imgHeight;
            ctx.drawImage(image, 0, 0, imgWidth, imgHeight);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            encoder.align('center');
            encoder.image(imageData, 's8');
            encoder.line('');
        } catch (e) {
            console.error('Failed to process logo for printing:', e);
        }
    }
    
    receiptText.split('\n').forEach(line => {
        if (line.startsWith('TOTAL')) {
            encoder.bold(true).line(line).bold(false);
        } else {
            encoder.line(line);
        }
    });

    encoder
        .feed(3)
        .cut();
    return encoder.encode();
}

export async function generateReceiptContent(transactionData, targetElementId = 'receiptContent') {
    const contentEl = document.getElementById(targetElementId);
    if (contentEl) {
        contentEl.innerHTML = await _generateReceiptHTML(transactionData, targetElementId === 'previewReceiptContent');
    }
}
window.generateReceiptContent = generateReceiptContent;

export async function printReceipt(isAutoPrint = false) {
    if (!window.app.isPrinterReady) {
        showToast('Fitur cetak tidak tersedia.');
        return;
    }
    if (!window.app.currentReceiptTransaction) {
        showToast('Tidak ada data struk untuk dicetak.');
        return;
    }
    
    try {
        if (!isAutoPrint) showToast('Menyiapkan struk...', 2000);
        const data = await generateReceiptEscPos(window.app.currentReceiptTransaction);
        sendToRawBT(data);
    } catch (error) {
        console.error('Print error:', error);
        if (!isAutoPrint) {
            showConfirmationModal(
                'Gagal Mencetak Struk',
                'Struk gagal dicetak. Ini bisa terjadi jika aplikasi RawBT tidak terinstall atau belum diatur.<br><br>Coba gunakan tombol "Share ke Printer" sebagai alternatif.',
                () => {},
                'Mengerti',
                'bg-blue-500'
            );
        }
    }
};

export async function shareReceipt() {
    if (!window.app.isPrinterReady) {
        showToast('Fitur cetak tidak tersedia.');
        return;
    }
     if (!window.app.currentReceiptTransaction) {
        showToast('Tidak ada data struk untuk dibagikan.');
        return;
    }

    if (!navigator.share) {
        showToast('Fitur Share tidak didukung di browser ini.');
        return;
    }

    try {
        const data = await generateReceiptEscPos(window.app.currentReceiptTransaction);
        const blob = new Blob([data], { type: 'application/vnd.rawbt' });
        const file = new File([blob], `struk_${window.app.currentReceiptTransaction.id}.bin`, { type: 'application/vnd.rawbt' });

        await navigator.share({
            title: `Struk Transaksi #${window.app.currentReceiptTransaction.id}`,
            files: [file]
        });
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Share error:', error);
            showToast('Gagal membagikan struk.');
        }
    }
};

async function generateLabelEscPos() {
    if (!window.app.isPrinterReady) {
        throw new Error('Printer library not loaded.');
    }

    const productName = document.getElementById('product-name').value.trim();
    const productPrice = document.getElementById('product-price').value.trim();
    const barcodeCode = document.getElementById('barcode-code').value.trim();

    const paperSize = await getSettingFromDB('printerPaperSize') || '80mm';

    const encoder = new EscPosEncoder.default();
    encoder
        .initialize()
        .raw([0x1b, 0x40]);

    encoder.align('center');

    if (productName) {
        encoder.bold(true).line(productName).bold(false);
    }

    if (productPrice) {
        const formattedPrice = `Rp ${window.formatCurrency(productPrice)}`;
        encoder.line(formattedPrice);
    }

    encoder.line('');

    if (barcodeCode) {
        encoder.raw([0x1d, 0x6b, 0x49]);
        const barcodeLength = barcodeCode.length;
        encoder.raw([barcodeLength]);
        encoder.raw(new TextEncoder().encode(barcodeCode));

        encoder.align('center').line(barcodeCode);
    }

    encoder
        .feed(3)
        .cut();

    return encoder.encode();
}

export async function testPrint() {
    if (!window.app.isPrinterReady) {
        showToast('Fitur cetak tidak tersedia.');
        return;
    }
    try {
        const paperSize = await getSettingFromDB('printerPaperSize') || '80mm';
        const paperWidthChars = paperSize === '58mm' ? 32 : 42;
        const encoder = new EscPosEncoder.default();

        const data = encoder
            .initialize()
            .raw([0x1b, 0x40])
            .align('center')
            .width(2).height(2)
            .line('Test Cetak')
            .width(1).height(1)
            .line('----------------')
            .line('Printer terhubung!')
            .line(`Lebar kertas: ${paperWidthChars} karakter`)
            .line(new Date().toLocaleString('id-ID'))
            .feed(3)
            .cut()
            .encode();

        sendToRawBT(data);

    } catch(e) {
        showToast('Gagal melakukan test cetak.');
        console.error(e);
    }
};

export function showPrintHelpModal() {
    const modal = document.getElementById('printHelpModal');
    if (modal) modal.classList.remove('hidden');
};
export function closePrintHelpModal() {
    const modal = document.getElementById('printHelpModal');
    if (modal) modal.classList.add('hidden');
};

export async function showPreviewReceiptModal() {
    if (window.app.cart.items.length === 0) {
        showToast('Keranjang kosong, tidak ada struk untuk ditampilkan.');
        return;
    }
    
    const subtotalAfterDiscount = window.app.cart.items.reduce((sum, item) => {
        return sum + Math.round(item.effectivePrice * item.quantity);
    }, 0);

    let calculatedFees = [];
    let totalFeeAmount = 0;
    window.app.cart.fees.forEach(fee => {
        const feeAmountRaw = fee.type === 'percentage' ? subtotalAfterDiscount * (fee.value / 100) : fee.value;
        const roundedFeeAmount = Math.round(feeAmountRaw);
        calculatedFees.push({ ...fee, amount: roundedFeeAmount });
        totalFeeAmount += roundedFeeAmount;
    });
    
    const total = subtotalAfterDiscount + totalFeeAmount;

    const subtotal_raw = window.app.cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const totalDiscount_raw = window.app.cart.items.reduce((sum, item) => {
         const discountAmount = item.price * (item.discountPercentage / 100);
         return sum + (discountAmount * item.quantity);
    }, 0);

    const previewData = {
        items: window.app.cart.items,
        subtotal: subtotal_raw,
        totalDiscount: totalDiscount_raw,
        fees: calculatedFees,
        total,
        cashPaid: 0,
        change: 0,
        date: new Date().toISOString()
    };
    
    await generateReceiptContent(previewData, 'previewReceiptContent');
    document.getElementById('previewReceiptModal').classList.remove('hidden');
}

export function closePreviewReceiptModal() {
    document.getElementById('previewReceiptModal').classList.add('hidden');
}

export function updateFeatureAvailability() {
    const scanBtn = document.getElementById('scanBarcodeBtn');
    if (scanBtn) {
        if (!window.app.isScannerReady) {
            scanBtn.disabled = true;
            scanBtn.classList.remove('bg-gray-600');
            scanBtn.classList.add('bg-gray-400', 'cursor-not-allowed');
            scanBtn.title = 'Pemindai barcode gagal dimuat.';
        } else {
            scanBtn.disabled = false;
            scanBtn.classList.add('bg-gray-600');
            scanBtn.classList.remove('bg-gray-400', 'cursor-not-allowed');
            scanBtn.title = '';
        }
    }

    const printReceiptBtn = document.getElementById('printReceiptBtn');
    const autoPrintContainer = document.getElementById('autoPrintContainer');
    const testPrintBtn = document.getElementById('testPrintBtn');

    if (!window.app.isPrinterReady) {
        if (printReceiptBtn) {
            printReceiptBtn.disabled = true;
            printReceiptBtn.classList.remove('bg-gray-600');
            printReceiptBtn.classList.add('bg-gray-400', 'cursor-not-allowed');
            printReceiptBtn.title = 'Fitur cetak gagal dimuat.';
        }
        if (testPrintBtn) {
            testPrintBtn.disabled = true;
            testPrintBtn.title = 'Fitur cetak gagal dimuat.';
        }
        if (autoPrintContainer) {
            autoPrintContainer.classList.add('opacity-50');
            const autoPrintCheckbox = document.getElementById('autoPrintReceipt');
            if (autoPrintCheckbox) autoPrintCheckbox.disabled = true;

            if (!autoPrintContainer.parentElement.querySelector('.library-error-note')) {
                const note = document.createElement('p');
                note.className = 'text-xs text-red-500 text-center mt-2 library-error-note';
                note.textContent = 'Fitur cetak tidak tersedia (library gagal dimuat).';
                autoPrintContainer.parentElement.insertBefore(note, autoPrintContainer.nextSibling);
            }
        }
    }
}

// --- BARCODE / LABEL GENERATOR ---
export function setupBarcodeGenerator() {
    const generateBtn = document.getElementById('generateBarcodeLabelBtn');
    const downloadPngBtn = document.getElementById('downloadPngBtn');
    const printLabelBtn = document.getElementById('printLabelBtn');

    if (!generateBtn || !downloadPngBtn || !printLabelBtn) return;

    generateBtn.addEventListener('click', () => {
        const productName = document.getElementById('product-name').value.trim();
        const productPrice = document.getElementById('product-price').value.trim();
        const barcodeCode = document.getElementById('barcode-code').value.trim();

        if (!barcodeCode) {
            showToast('Teks/Angka untuk Barcode wajib diisi.');
            return;
        }

        const outputName = document.getElementById('output-product-name');
        const outputPrice = document.getElementById('output-product-price');
        const outputBarcodeText = document.getElementById('output-barcode-text');
        
        outputName.textContent = productName;
        outputPrice.textContent = productPrice ? `Rp ${window.formatCurrency(productPrice)}` : '';
        outputBarcodeText.textContent = barcodeCode;

        try {
            JsBarcode("#barcode", barcodeCode, {
                format: "CODE128",
                lineColor: "#000",
                width: 2,
                height: 50,
                displayValue: false
            });
            document.getElementById('barcodeLabelOutput').classList.remove('hidden');
            document.getElementById('download-buttons').classList.remove('hidden');
        } catch (e) {
            showToast('Gagal membuat barcode. Pastikan teks valid.');
            console.error("JsBarcode error:", e);
        }
    });

    downloadPngBtn.addEventListener('click', async () => {
        try {
            const { default: html2canvas } = await import('https://cdn.skypack.dev/html2canvas');
            const labelContent = document.getElementById('labelContent');
            const canvas = await html2canvas(labelContent, {
                scale: 3,
                backgroundColor: '#ffffff'
            });
            const link = document.createElement('a');
            link.download = `label-${document.getElementById('barcode-code').value}.png`;
            link.href = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
            link.click();
        } catch (e) {
            console.error('Download PNG failed:', e);
            showToast('Gagal mengunduh PNG. Coba lagi.');
        }
    });
    
    printLabelBtn.addEventListener('click', async () => {
        if (!window.app.isPrinterReady) {
            showToast('Fitur cetak tidak tersedia.');
            return;
        }
        try {
            const data = await generateLabelEscPos();
            sendToRawBT(data);
        } catch (e) {
            console.error('Print label failed:', e);
            showToast('Gagal mencetak label.');
        }
    });
}
