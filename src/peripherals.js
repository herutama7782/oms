async function generateLabelEscPos() {
    if (!window.app.isPrinterReady) {
        throw new Error('Printer library not loaded.');
    }

    const productName = document.getElementById('product-name').value.trim();
    const productPrice = document.getElementById('product-price').value.trim();
    const barcodeCode = document.getElementById('barcode-code').value.trim();

    const paperSize = await getSettingFromDB('printerPaperSize') || '80mm';

    // --- PERBAIKAN UTAMA: Hitung lebar berdasarkan resolusi printer (dots) ---
    const paperWidthDots = paperSize === '58mm' ? 384 : 576;

    // Estimasi lebar karakter (dalam dots) untuk font default (Font A) dan Font B
    const charWidthFontA = 12; // ~12 dots per karakter (Font A, normal)
    const charWidthFontB = 9;  // ~9 dots per karakter (Font B, kecil)

    // Hitung jumlah karakter maksimum yang muat
    const paperWidthChars = Math.floor(paperWidthDots / charWidthFontA);
    const paperWidthCharsFontB = Math.floor(paperWidthDots / charWidthFontB);

    // Tambahkan margin aman agar tidak terpotong
    const safePaperWidthChars = Math.max(20, paperWidthChars - 2);
    const safePaperWidthCharsFontB = Math.max(20, paperWidthCharsFontB - 2);

    const encoder = new EscPosEncoder.default();
    encoder
        .initialize()
        .raw([0x1b, 0x40]) // reset printer
        .raw([0x1b, 0x33, 24]) // line spacing: single (24 dots)
        .align('center');

    if (productName) {
        encoder.bold(true);
        const nameLines = wrapWords(productName, safePaperWidthChars).map(l => l.trim());
        nameLines.forEach(line => encoder.line(line));
        encoder.bold(false);
    }

    if (productPrice) {
        const formattedPrice = `Rp ${formatCurrency(productPrice)}`;
        const priceLines = wrapWords(formattedPrice, safePaperWidthChars).map(l => l.trim());
        priceLines.forEach(line => encoder.line(line));
    }

    if (barcodeCode) {
        // Cetak barcode (tanpa teks bawah otomatis)
        encoder.raw([0x1d, 0x68, 60]); // Tinggi barcode: 60 dots
        encoder.raw([0x1d, 0x48, 0]);  // Sembunyikan HRI (teks bawah barcode)
        encoder.raw([0x1d, 0x6b, 0x49]); // Format: CODE128
        const barcodeLength = barcodeCode.length;
        encoder.raw([barcodeLength]);
        encoder.raw(new TextEncoder().encode(barcodeCode));

        // Cetak teks barcode secara manual dengan Font B agar lebih kecil & muat
        encoder.font('b');
        const barcodeTextLines = wrapWords(barcodeCode, safePaperWidthCharsFontB).map(l => l.trim());
        barcodeTextLines.forEach(line => encoder.line(line));
        encoder.font('a'); // Kembali ke Font A
    }

    encoder.raw([0x1b, 0x32]); // Reset line spacing ke default
    encoder.feed(3).cut();
    return encoder.encode();
}