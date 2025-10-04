/**
 * NTAG215 Scanner and Saver
 * @name NTAG215 Scanner
 * @version 1.0.0
 * @author Toolbox Team
 * @description Scans NTAG215 tags using Chameleon Ultra reader mode and saves dump to /data
 * @source https://github.com/GameTec-live/ChameleonUltra
 */

(async function() {
    // Check if device is connected
    if (!chameleonUltra || !chameleonUltra.isConnected()) {
        logToConsole('❌ Device not connected! Please connect first.', true);
        return;
    }

    // Import constants from Chameleon Ultra device extension
    const {
        CMD_HF14A_SCAN,
        CMD_SET_ACTIVE_MODE,
        CMD_HF14A_RAW
    } = ToolboxAPI.ChameleonUltra;

    logToConsole('🔍 NTAG215 Scanner & Saver');
    logToConsole('━'.repeat(60));

    try {

        // Step 0: Switch to reader mode
        logToConsole('🔄 Switching to reader mode...');
        const modeData = new Uint8Array([1]); // 1 = reader mode, 0 = emulator/tag mode
        const modeResponse = await chameleonUltra.cmd(CMD_SET_ACTIVE_MODE, modeData);

        if (modeResponse.status !== 0x68) { // 0x68 = SUCCESS
            logToConsole(`❌ Failed to switch to reader mode: status 0x${modeResponse.status.toString(16)}`, true);
            return;
        }
        logToConsole('✓ Reader mode activated');

        // Wait a moment for mode switch to complete
        await new Promise(resolve => setTimeout(resolve, 300));

        // Step 1: Scan for HF tag (with retries)
        logToConsole('');
        logToConsole('📡 Scanning for HF tag...');
        logToConsole('   Place tag flat on TOP of Chameleon Ultra');

        let scanResponse = null;
        const maxRetries = 5;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            scanResponse = await chameleonUltra.cmd(CMD_HF14A_SCAN);

            // Check if card was found
            if (scanResponse.data && scanResponse.data.length > 0) {
                logToConsole(`✓ Tag detected on attempt ${attempt}!`);
                break;
            }

            if (attempt < maxRetries) {
                logToConsole(`   Attempt ${attempt}/${maxRetries} - No tag detected, retrying...`);
                await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
            }
        }

        if (!scanResponse.data || scanResponse.data.length === 0) {
            logToConsole(`❌ No tag found after ${maxRetries} attempts`, true);
            logToConsole('   Tips:');
            logToConsole('   - Place tag flat on TOP of the Chameleon (where antenna is)');
            logToConsole('   - Try different positions');
            logToConsole('   - Make sure tag is NFC/RFID compatible (ISO14443A)');
            return;
        }

        // Parse scan response
        // Format: UID_LEN(1) + UID(4-10) + ATQA(2) + SAK(1) + ATS_LEN(1) + ATS(0-255)
        const uidLen = scanResponse.data[0];
        const uid = scanResponse.data.slice(1, 1 + uidLen);
        const atqa = scanResponse.data.slice(1 + uidLen, 1 + uidLen + 2);
        const sak = scanResponse.data[1 + uidLen + 2];

        const uidHex = Array.from(uid).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
        const atqaHex = Array.from(atqa).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        const sakHex = sak.toString(16).padStart(2, '0').toUpperCase();

        logToConsole(`✓ Tag detected:`);
        logToConsole(`  UID: ${uidHex}`);
        logToConsole(`  ATQA: ${atqaHex}`);
        logToConsole(`  SAK: ${sakHex}`);

        // Check if it's an NTAG215 (SAK should be 0x00, ATQA should be 0x44 0x00)
        const isNTAG = sak === 0x00 && atqa[0] === 0x44 && atqa[1] === 0x00;
        if (!isNTAG) {
            logToConsole(`⚠️  Warning: Tag may not be NTAG215 (SAK=${sakHex}, ATQA=${atqaHex})`);
            logToConsole('   Continuing anyway...');
        }

        // Step 2: Read all pages
        // NTAG215 has 135 pages (0-134), each page is 4 bytes = 540 bytes total
        logToConsole('');
        logToConsole('📖 Reading NTAG215 data (135 pages, 540 bytes)...');

        const totalPages = 135;
        const pageSize = 4;
        let allData = new Uint8Array(totalPages * pageSize);

        // Read pages using RAW command (0x30 = READ, reads 4 pages at once)
        for (let page = 0; page < totalPages; page += 4) {
            // HF14A_RAW command format: options(1) + timeout_ms(2) + bit_len(2) + data
            // Options: activateRfField(128) + waitResponse(64) + appendCrc(32) + autoSelect(16) + keepRfField(8) + checkResponseCrc(4)

            // First read: activate field and select tag. Subsequent reads: keep field on
            let options;
            if (page === 0) {
                options = 128 + 64 + 32 + 16 + 8 + 4; // = 252 (all options including autoSelect)
            } else {
                options = 128 + 64 + 32 + 8 + 4; // = 236 (no autoSelect, keep field on)
            }

            const timeoutMs = 100; // 100ms timeout
            const rawData = new Uint8Array([0x30, page]); // READ command + page number
            const bitLen = rawData.length * 8; // 2 bytes = 16 bits

            // Build complete command (uint16 values are big-endian)
            const readCmd = new Uint8Array([
                options,
                (timeoutMs >> 8) & 0xFF, timeoutMs & 0xFF, // timeout (big-endian uint16)
                (bitLen >> 8) & 0xFF, bitLen & 0xFF,       // bit length (big-endian uint16)
                ...rawData                                  // actual command data
            ]);

            const pageResponse = await chameleonUltra.cmd(CMD_HF14A_RAW, readCmd);

            if (pageResponse.status !== 0x00) { // 0x00 = HF_TAG_OK
                logToConsole(`❌ Failed to read page ${page}: status 0x${pageResponse.status.toString(16)}`, true);
                return;
            }

            // READ command returns 16 bytes (4 pages of 4 bytes each)
            const dataReceived = pageResponse.data.slice(0, 16);
            const copyLen = Math.min(16, (totalPages - page) * pageSize);
            allData.set(dataReceived.slice(0, copyLen), page * pageSize);

            const progress = Math.round(((page + 4) / totalPages) * 100);
            if (page % 20 === 0) { // Log every 20 pages
                logToConsole(`  Progress: ${Math.min(100, progress)}% (pages ${page}-${Math.min(page + 3, totalPages - 1)})`);
            }
        }

        logToConsole('✓ Read complete!');

        // Step 3: Save to file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const uidClean = uidHex.replace(/:/g, '');
        const filename = `/data/ntag215_${uidClean}_${timestamp}.bin`;

        logToConsole('');
        logToConsole(`💾 Saving to: ${filename}`);
        await window.ToolboxAPI.fs.writeFile(filename, allData);
        logToConsole('✓ File saved successfully!');

        // Step 4: Display summary
        logToConsole('');
        logToConsole('━'.repeat(60));
        logToConsole('📊 Summary:');
        logToConsole(`  UID:      ${uidHex}`);
        logToConsole(`  Size:     ${allData.length} bytes`);
        logToConsole(`  File:     ${filename}`);
        logToConsole('');

        // Show hex dump of first 64 bytes
        logToConsole('📄 First 64 bytes (hex):');
        for (let i = 0; i < Math.min(64, allData.length); i += 16) {
            const chunk = allData.slice(i, i + 16);
            const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
            const ascii = Array.from(chunk).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
            logToConsole(`  ${i.toString(16).padStart(4, '0')}: ${hex.padEnd(48, ' ')} | ${ascii}`);
        }

        logToConsole('');
        logToConsole('━'.repeat(60));
        logToConsole('✅ Scan and save complete!');

    } catch (error) {
        logToConsole(`❌ Error: ${error.message}`, true);
        console.error('Scan error:', error);
    } finally {
        // Always switch back to emulator mode when done
        try {
            logToConsole('');
            logToConsole('🔄 Switching back to emulator mode...');
            const modeData = new Uint8Array([0]); // 0 = emulator mode
            await chameleonUltra.cmd(CMD_SET_ACTIVE_MODE, modeData);
            logToConsole('✓ Emulator mode restored');
        } catch (modeError) {
            logToConsole(`⚠️  Warning: Could not restore emulator mode: ${modeError.message}`, true);
        }
    }
})();
