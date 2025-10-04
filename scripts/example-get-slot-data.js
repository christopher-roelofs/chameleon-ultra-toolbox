/**
 * Slot Data Reader
 * @name Slot Data Reader
 * @version 1.0.0
 * @author Toolbox Team
 * @description Reads and displays tag data from Chameleon Ultra slot 1 (supports NTAG and Mifare)
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
        CMD_GET_SLOT_INFO,
        CMD_GET_SLOT_TAG_NICK,
        CMD_MF0_NTAG_READ_EMU_PAGE_DATA
    } = ToolboxAPI.ChameleonUltra;

    const slotNum = 1; // Slot 1
    logToConsole(`📖 Reading data from Slot ${slotNum}...`);

    try {
        // First, get slot info to see what's in it
        // CMD_GET_SLOT_INFO (1021) returns info for all 8 slots
        // No parameters needed
        const slotInfoResponse = await chameleonUltra.cmd(CMD_GET_SLOT_INFO);

        if (slotInfoResponse.status !== 0x68) { // 0x68 = SUCCESS
            logToConsole(`❌ Failed to get slot info: 0x${slotInfoResponse.status.toString(16)}`, true);
            return;
        }

        // Parse slot info: 8 slots × 4 bytes each (hf_tag_type(2) + lf_tag_type(2))
        // Each slot has: HF tag type (2 bytes) + LF tag type (2 bytes)
        const slotIndex = slotNum - 1;
        const slotOffset = slotIndex * 4;

        const hfTagType = (slotInfoResponse.data[slotOffset] << 8) | slotInfoResponse.data[slotOffset + 1];
        const lfTagType = (slotInfoResponse.data[slotOffset + 2] << 8) | slotInfoResponse.data[slotOffset + 3];

        // Determine which type is active (non-zero)
        let tagType, frequency;
        if (hfTagType !== 0) {
            tagType = hfTagType;
            frequency = 2; // HF
        } else if (lfTagType !== 0) {
            tagType = lfTagType;
            frequency = 1; // LF
        } else {
            logToConsole(`❌ Slot ${slotNum} appears to be empty`, true);
            return;
        }

        const frequencyNames = { 1: 'LF', 2: 'HF' };
        const tagTypeNames = {
            // HF Tags
            1000: 'Mifare Mini',
            1001: 'Mifare Classic 1K',
            1002: 'Mifare Classic 2K',
            1003: 'Mifare Classic 4K',
            1100: 'NTAG 213',
            1101: 'NTAG 215',
            1102: 'NTAG 216',
            1103: 'Mifare Ultralight',
            1104: 'Mifare Ultralight C',
            1105: 'Mifare Ultralight EV1 (640 bit)',
            1106: 'Mifare Ultralight EV1 (1312 bit)',
            1107: 'NTAG 210',
            1108: 'NTAG 212',
            // LF Tags
            100: 'EM410X',
            200: 'HIDProx',
            170: 'Viking'
        };

        logToConsole('━━━━━━━━━━━━━━━━━━━━━━━');
        logToConsole(`📍 Slot ${slotNum} Info:`);
        logToConsole(`   Frequency: ${frequencyNames[frequency] || frequency}`);
        logToConsole(`   Tag Type: ${tagTypeNames[tagType] || tagType}`);

        // Get slot nickname
        try {
            const nickData = new Uint8Array([slotIndex, frequency]);
            const nickResponse = await chameleonUltra.cmd(CMD_GET_SLOT_TAG_NICK, nickData);
            if (nickResponse.status === 0x68 && nickResponse.data.length > 0) {
                const nickname = new TextDecoder().decode(nickResponse.data);
                logToConsole(`   Nickname: "${nickname}"`);
            }
        } catch (e) {
            // Nickname might not be set, ignore error
        }

        // If it's an NTAG tag, read the emulation data
        if (tagType >= 1100 && tagType <= 1108) {
            logToConsole('');
            logToConsole('📄 Reading NTAG emulation data...');

            // For NTAG 215: 135 pages (0-134), but typically we care about first 140 bytes
            // Read pages 0-9 which contains UID, version, and user data start
            const pagesToRead = 10;
            const pageData = new Uint8Array(pagesToRead * 4); // Each page is 4 bytes

            // Read all pages at once (more efficient)
            // CMD_MF0_NTAG_READ_EMU_PAGE_DATA (4021)
            // Format: page_start(1) + page_count(1)
            const readCmd = new Uint8Array([0, pagesToRead]); // Start at page 0, read 10 pages
            const pageResponse = await chameleonUltra.cmd(CMD_MF0_NTAG_READ_EMU_PAGE_DATA, readCmd);

            if (pageResponse.status === 0x68 && pageResponse.data.length >= pagesToRead * 4) {
                pageData.set(pageResponse.data.slice(0, pagesToRead * 4));
            } else if (pageResponse.status !== 0x68) {
                logToConsole(`❌ Failed to read pages: status 0x${pageResponse.status.toString(16)}`, true);
                logToConsole('━━━━━━━━━━━━━━━━━━━━━━━');
                return;
            }

            // Display UID (from pages 0-2)
            const uidBytes = [
                pageData[0], pageData[1], pageData[2], // Page 0: first 3 bytes
                pageData[4], pageData[5], pageData[6], pageData[7] // Page 1: 4 bytes
            ];
            const uidHex = Array.from(uidBytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

            logToConsole(`   UID: ${uidHex}`);

            // Show first 40 bytes in hex dump format
            logToConsole('');
            logToConsole('📊 First 40 bytes (hex):');
            for (let i = 0; i < Math.min(40, pageData.length); i += 16) {
                const chunk = pageData.slice(i, i + 16);
                const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
                const ascii = Array.from(chunk).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
                logToConsole(`   ${i.toString(16).padStart(4, '0')}: ${hex.padEnd(48, ' ')} | ${ascii}`);
            }

            logToConsole('━━━━━━━━━━━━━━━━━━━━━━━');

            return {
                slot: slotNum,
                frequency: frequencyNames[frequency],
                tagType: tagTypeNames[tagType] || tagType,
                uid: uidHex,
                data: pageData
            };
        } else if (tagType >= 1000 && tagType <= 1003) {
            logToConsole('');
            logToConsole('ℹ️  Mifare Classic tags require reading individual blocks');
            logToConsole('   Use CMD_MF1_READ_EMU_BLOCK_DATA (4008) to read specific blocks');
            logToConsole('━━━━━━━━━━━━━━━━━━━━━━━');
        } else {
            logToConsole('━━━━━━━━━━━━━━━━━━━━━━━');
            logToConsole('ℹ️  Tag type not supported for automatic data reading yet');
        }

    } catch (error) {
        logToConsole(`❌ Error: ${error.message}`, true);
    }
})();
