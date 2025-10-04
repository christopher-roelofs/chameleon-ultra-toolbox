/**
 * RFID Extension
 * @name RFID
 * @description Analyzes HF, LF, and UHF RFID dump files
 * @version 1.0.0
 * @author Toolbox Team
 */

class RFID {
    constructor() {
        // Tag type signatures and sizes
        this.tagSignatures = {
            // HF Tags (NFC)
            ntag210: { size: 80, pages: 20, name: 'NTAG 210' },
            ntag212: { size: 164, pages: 41, name: 'NTAG 212' },
            ntag213: { size: 180, pages: 45, name: 'NTAG 213' },
            ntag215: { size: 540, pages: 135, name: 'NTAG 215' },
            ntag216: { size: 924, pages: 231, name: 'NTAG 216' },
            mifareMini: { size: 320, blocks: 20, name: 'Mifare Mini' },
            mifareClassic1K: { size: 1024, blocks: 64, name: 'Mifare Classic 1K' },
            mifareClassic2K: { size: 2048, blocks: 128, name: 'Mifare Classic 2K' },
            mifareClassic4K: { size: 4096, blocks: 256, name: 'Mifare Classic 4K' },
            mifareUltralight: { size: 64, pages: 16, name: 'Mifare Ultralight' },
            mifareUltralightC: { size: 192, pages: 48, name: 'Mifare Ultralight C' },

            // LF Tags
            em410x: { size: 5, name: 'EM410X', bits: 40 },
            t5577: { size: 264, blocks: 8, name: 'T5577' },
            hidProx: { size: 96, name: 'HID Prox' },
        };
    }

    /**
     * Main analysis function
     * @param {Uint8Array|string} data - Binary data or file path
     * @returns {Object} Analysis results
     */
    async analyze(data) {
        // If string, assume it's a file path
        if (typeof data === 'string') {
            if (window.ToolboxAPI && window.ToolboxAPI.readFile) {
                data = await window.ToolboxAPI.readFile(data);
            } else {
                throw new Error('File reading not available. Pass Uint8Array directly.');
            }
        }

        if (!data || data.length === 0) {
            return { error: 'No data provided or file is empty' };
        }

        const result = {
            fileSize: data.length,
            fileSizeBits: data.length * 8,
            frequency: null,
            tagType: null,
            confidence: 0,
            details: {},
            data: data
        };

        // Determine tag type based on size and content
        this.detectTagType(data, result);

        // Perform frequency-specific analysis
        if (result.frequency === 'HF') {
            this.analyzeHF(data, result);
        } else if (result.frequency === 'LF') {
            this.analyzeLF(data, result);
        }

        return result;
    }

    /**
     * Detect tag type based on file size and content
     */
    detectTagType(data, result) {
        const size = data.length;

        // Check exact size matches first
        for (const [key, sig] of Object.entries(this.tagSignatures)) {
            if (sig.size === size) {
                result.tagType = sig.name;
                result.confidence = 90;

                // Determine frequency
                if (key.startsWith('ntag') || key.startsWith('mifare')) {
                    result.frequency = 'HF';
                } else if (key.startsWith('em') || key.startsWith('t55') || key.startsWith('hid')) {
                    result.frequency = 'LF';
                }

                return;
            }
        }

        // If no exact match, use heuristics
        if (size === 5) {
            result.tagType = 'EM410X';
            result.frequency = 'LF';
            result.confidence = 95;
        } else if (size >= 64 && size <= 1024) {
            result.frequency = 'HF';
            result.tagType = 'Unknown HF/NFC';
            result.confidence = 50;
        } else if (size < 64) {
            result.frequency = 'LF';
            result.tagType = 'Unknown LF';
            result.confidence = 50;
        } else {
            result.tagType = 'Unknown';
            result.confidence = 0;
        }
    }

    /**
     * Analyze HF/NFC tags
     */
    analyzeHF(data, result) {
        const pageSize = 4;
        const totalPages = Math.floor(data.length / pageSize);

        result.details.pageSize = pageSize;
        result.details.totalPages = totalPages;

        // Extract UID (first 3-10 bytes depending on UID length)
        const uid = this.extractUID(data);
        result.details.uid = uid;
        result.details.uidHex = Array.from(uid).map(b => {
            const byte = typeof b === 'number' ? b : b.charCodeAt(0);
            return byte.toString(16).padStart(2, '0');
        }).join(':').toUpperCase();

        // Check for NTAG-specific features
        if (result.tagType && result.tagType.startsWith('NTAG')) {
            this.analyzeNTAG(data, result);
        } else if (result.tagType && result.tagType.includes('Mifare Classic')) {
            this.analyzeMifareClassic(data, result);
        }

        // Check for NDEF data
        this.checkNDEF(data, result);

        // Extract readable text
        this.extractText(data, result);
    }

    /**
     * Extract UID from HF tag
     */
    extractUID(data) {
        // For most HF tags, UID is in the first page
        // Single size UID (4 bytes): bytes 0-2 of page 0, BCC in byte 3
        // Double size UID (7 bytes): CT(0x88) + 3 bytes in page 0, 4 bytes in page 1

        if (data.length < 8) return new Uint8Array([]);

        // Check for cascade tag (CT = 0x88) indicating 7-byte UID
        if (data[0] === 0x88) {
            // 7-byte UID
            return data.slice(0, 8); // Include both pages for context
        } else {
            // 4-byte UID
            return data.slice(0, 4);
        }
    }

    /**
     * Analyze NTAG-specific features
     */
    analyzeNTAG(data, result) {
        const pageSize = 4;

        // NTAG memory structure
        // Pages 0-1: UID/Serial
        // Page 2: Internal/Lock bytes
        // Page 3: Capability Container (CC)
        // Page 4+: User memory
        // Last pages: Configuration/Lock

        if (data.length >= 16) {
            // Extract Capability Container
            const cc = data.slice(12, 16);
            result.details.capabilityContainer = {
                raw: Array.from(cc).map(b => b.toString(16).padStart(2, '0')).join(' ').toUpperCase(),
                magic: cc[0].toString(16).padStart(2, '0'),
                version: `${(cc[1] >> 4)}.${(cc[1] & 0x0F)}`,
                memorySize: cc[2] * 8,
                readWrite: cc[3] === 0x00 ? 'Read/Write' : 'Read-only'
            };
        }

        // Check lock bytes
        if (data.length >= 12) {
            const lockBytes = data.slice(10, 12);
            result.details.lockBytes = Array.from(lockBytes).map(b => b.toString(16).padStart(2, '0')).join(' ').toUpperCase();
            result.details.isLocked = lockBytes[0] !== 0x00 || lockBytes[1] !== 0x00;
        }

        // Extract signature (if present in dump)
        // NTAG signatures are typically 32 bytes
        const sigOffset = data.length - 32;
        if (sigOffset > 0 && result.tagType === 'NTAG 215') {
            // NTAG 215 signature is usually at a specific offset
            // We'll check if there's non-zero data that could be a signature
        }
    }

    /**
     * Analyze Mifare Classic
     */
    analyzeMifareClassic(data, result) {
        const blockSize = 16;
        const totalBlocks = Math.floor(data.length / blockSize);

        result.details.blockSize = blockSize;
        result.details.totalBlocks = totalBlocks;
        result.details.sectors = Math.floor(totalBlocks / 4);

        // Extract UID from block 0
        if (data.length >= blockSize) {
            const uid = data.slice(0, 4);
            result.details.uid = uid;
            result.details.uidHex = Array.from(uid).map(b => {
                const byte = typeof b === 'number' ? b : b.charCodeAt(0);
                return byte.toString(16).padStart(2, '0');
            }).join(':').toUpperCase();

            // Check manufacturer byte
            const manufacturer = data[0];
            result.details.manufacturer = this.getMifareManufacturer(manufacturer);
        }

        // Analyze sector trailers (every 4th block)
        const accessBits = [];
        for (let sector = 0; sector < result.details.sectors; sector++) {
            const trailerBlock = (sector * 4) + 3;
            const trailerOffset = trailerBlock * blockSize;

            if (trailerOffset + blockSize <= data.length) {
                const trailer = data.slice(trailerOffset, trailerOffset + blockSize);
                accessBits.push({
                    sector,
                    keyA: Array.from(trailer.slice(0, 6)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase(),
                    accessBits: Array.from(trailer.slice(6, 10)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase(),
                    keyB: Array.from(trailer.slice(10, 16)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
                });
            }
        }
        result.details.sectorTrailers = accessBits;
    }

    /**
     * Get Mifare manufacturer name
     */
    getMifareManufacturer(byte) {
        const manufacturers = {
            0x04: 'NXP',
            0x02: 'STMicroelectronics',
            0x44: 'Nationz',
            0x62: 'Fudan',
            0x63: 'Fudan'
        };
        return manufacturers[byte] || `Unknown (0x${byte.toString(16).padStart(2, '0')})`;
    }

    /**
     * Check for NDEF data
     */
    checkNDEF(data, result) {
        // NDEF starts with TLV (Type-Length-Value)
        // Look for NDEF message TLV (0x03)

        let ndefFound = false;
        let ndefOffset = -1;

        // Start searching from page 4 (byte 16) for NTAG
        for (let i = 16; i < Math.min(data.length - 2, 100); i++) {
            if (data[i] === 0x03) {
                ndefFound = true;
                ndefOffset = i;
                break;
            }
        }

        if (ndefFound) {
            result.details.hasNDEF = true;
            result.details.ndefOffset = ndefOffset;

            const ndefLength = data[ndefOffset + 1];
            result.details.ndefLength = ndefLength;

            // Try to parse NDEF record header
            if (ndefOffset + 2 + ndefLength <= data.length) {
                const ndefData = data.slice(ndefOffset + 2, ndefOffset + 2 + ndefLength);
                this.parseNDEF(ndefData, result);
            }
        } else {
            result.details.hasNDEF = false;
        }
    }

    /**
     * Parse NDEF record
     */
    parseNDEF(ndefData, result) {
        if (ndefData.length < 3) return;

        const header = ndefData[0];
        const typeLength = ndefData[1];
        const payloadLength = ndefData[2];

        const MB = (header & 0x80) !== 0; // Message Begin
        const ME = (header & 0x40) !== 0; // Message End
        const SR = (header & 0x10) !== 0; // Short Record
        const TNF = header & 0x07; // Type Name Format

        result.details.ndef = {
            messageBegin: MB,
            messageEnd: ME,
            shortRecord: SR,
            typeNameFormat: TNF,
            typeNameFormatName: this.getTNFName(TNF),
            typeLength: typeLength,
            payloadLength: payloadLength
        };

        // Extract type
        if (typeLength > 0 && ndefData.length >= 3 + typeLength) {
            const type = ndefData.slice(3, 3 + typeLength);
            result.details.ndef.type = String.fromCharCode(...type);
        }

        // Extract payload
        const payloadOffset = 3 + typeLength;
        if (payloadLength > 0 && ndefData.length >= payloadOffset + payloadLength) {
            const payload = ndefData.slice(payloadOffset, payloadOffset + payloadLength);
            result.details.ndef.payload = payload;
            result.details.ndef.payloadHex = Array.from(payload).map(b => b.toString(16).padStart(2, '0')).join(' ').toUpperCase();

            // Try to decode as text
            try {
                const payloadText = new TextDecoder('utf-8').decode(payload);
                result.details.ndef.payloadText = payloadText;
            } catch (e) {
                // Not valid UTF-8
            }
        }
    }

    /**
     * Get Type Name Format name
     */
    getTNFName(tnf) {
        const names = {
            0x00: 'Empty',
            0x01: 'Well-known',
            0x02: 'Media',
            0x03: 'Absolute URI',
            0x04: 'External',
            0x05: 'Unknown',
            0x06: 'Unchanged',
            0x07: 'Reserved'
        };
        return names[tnf] || 'Unknown';
    }

    /**
     * Extract readable text from data
     */
    extractText(data, result) {
        const texts = [];
        let currentText = [];

        for (let i = 0; i < data.length; i++) {
            const byte = data[i];

            // Printable ASCII range (0x20 to 0x7E)
            if (byte >= 0x20 && byte <= 0x7E) {
                currentText.push(String.fromCharCode(byte));
            } else {
                // Non-printable character
                if (currentText.length >= 4) { // Minimum 4 chars to be considered text
                    texts.push(currentText.join(''));
                }
                currentText = [];
            }
        }

        // Add final text if any
        if (currentText.length >= 4) {
            texts.push(currentText.join(''));
        }

        if (texts.length > 0) {
            result.details.extractedText = texts;
        }
    }

    /**
     * Analyze LF tags
     */
    analyzeLF(data, result) {
        if (result.tagType === 'EM410X' || data.length === 5) {
            this.analyzeEM410X(data, result);
        } else if (result.tagType === 'T5577') {
            this.analyzeT5577(data, result);
        }
    }

    /**
     * Analyze EM410X
     */
    analyzeEM410X(data, result) {
        if (data.length !== 5) {
            result.details.warning = 'EM410X should be 5 bytes';
            return;
        }

        result.details.idHex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        result.details.idDecimal = Array.from(data).map(b => b.toString(10).padStart(3, '0')).join(',');

        // Extract version/customer ID (first byte)
        result.details.version = data[0];

        // Extract ID (bytes 1-4)
        result.details.customerId = (data[1] << 24) | (data[2] << 16) | (data[3] << 8) | data[4];
        result.details.customerIdHex = result.details.customerId.toString(16).padStart(8, '0').toUpperCase();
    }

    /**
     * Analyze T5577
     */
    analyzeT5577(data, result) {
        const blockSize = 33; // 33 bytes per block (264 bits)
        const totalBlocks = 8;

        result.details.blockSize = blockSize;
        result.details.totalBlocks = totalBlocks;
        result.details.blocks = [];

        for (let i = 0; i < totalBlocks && i * blockSize < data.length; i++) {
            const blockData = data.slice(i * blockSize, Math.min((i + 1) * blockSize, data.length));
            result.details.blocks.push({
                block: i,
                hex: Array.from(blockData).map(b => b.toString(16).padStart(2, '0')).join(' ').toUpperCase(),
                size: blockData.length
            });
        }
    }

    /**
     * Generate hex dump
     */
    hexDump(data, bytesPerLine = 16) {
        const lines = [];
        for (let i = 0; i < data.length; i += bytesPerLine) {
            const lineData = data.slice(i, i + bytesPerLine);
            // Ensure we're working with byte values (0-255)
            const hex = Array.from(lineData).map(b => {
                const byte = typeof b === 'number' ? b : b.charCodeAt(0);
                return byte.toString(16).padStart(2, '0');
            }).join(' ');
            const ascii = Array.from(lineData).map(b => {
                const byte = typeof b === 'number' ? b : b.charCodeAt(0);
                return (byte >= 0x20 && byte <= 0x7E) ? String.fromCharCode(byte) : '.';
            }).join('');
            const offset = i.toString(16).padStart(4, '0');
            lines.push(`${offset}  ${hex.padEnd(bytesPerLine * 3 - 1, ' ')}  ${ascii}`);
        }
        return lines.join('\n');
    }
}

// Export for use in browser and scripts
if (typeof window !== 'undefined') {
    window.RFID = RFID;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RFID;
}

// Extension registration (when loaded via extension system)
if (typeof API !== 'undefined') {
    // Create global instance
    const rfid = new RFID();
    window.rfid = rfid;

    // Register as a library extension (not a device)
    API.registerDevice('rfid', 'RFID');

    // Register the analyze command under the rfid namespace
    API.registerDeviceCommand('rfid', 'analyze', 'Analyze RFID dump file', async (args) => {
        if (args.length === 0) {
            API.logToConsole('Usage: rfid analyze <file>', true);
            API.logToConsole('Example: rfid analyze data/dump.bin');
            return;
        }

        const filePath = args.join(' ');

        try {
            API.logToConsole(`Analyzing ${filePath}...`);
            API.logToConsole('');

            const result = await rfid.analyze(filePath);

            if (result.error) {
                API.logToConsole(`Error: ${result.error}`, true);
                return;
            }

            // Display formatted results
            displayAnalysis(result, rfid);

        } catch (err) {
            API.logToConsole(`Error: ${err.message}`, true);
        }
    });

    // Helper functions for formatted display
    function displayAnalysis(result, analyzer) {
        // Header
        API.logToConsole('═══════════════════════════════════════════════════════');
        API.logToConsole('  RFID DUMP ANALYSIS');
        API.logToConsole('═══════════════════════════════════════════════════════');
        API.logToConsole('');

        // Basic Info
        API.logToConsole('┌─ Basic Information');
        API.logToConsole(`│  File Size: ${result.fileSize} bytes (${result.fileSizeBits} bits)`);
        API.logToConsole(`│  Frequency: ${result.frequency || 'Unknown'}`);
        API.logToConsole(`│  Tag Type: ${result.tagType || 'Unknown'}`);
        API.logToConsole(`│  Confidence: ${result.confidence}%`);
        API.logToConsole('└─');
        API.logToConsole('');

        // Details
        if (Object.keys(result.details).length > 0) {
            displayDetails(result);
        }

        // Hex dump preview
        if (result.data && result.data.length > 0) {
            API.logToConsole('┌─ Hex Dump Preview (first 256 bytes)');
            const preview = analyzer.hexDump(result.data.slice(0, 256));
            preview.split('\n').forEach(line => {
                API.logToConsole(`│  ${line}`);
            });
            if (result.data.length > 256) {
                API.logToConsole(`│  ... (${result.data.length - 256} more bytes)`);
            }
            API.logToConsole('└─');
        }
    }

    function displayDetails(result) {
        const details = result.details;

        // UID
        if (details.uid) {
            API.logToConsole('┌─ UID Information');
            API.logToConsole(`│  UID (Hex): ${details.uidHex || Array.from(details.uid).map(b => {
                const byte = typeof b === 'number' ? b : b.charCodeAt(0);
                return byte.toString(16).padStart(2, '0');
            }).join(':').toUpperCase()}`);
            API.logToConsole(`│  UID Length: ${details.uid.length} bytes`);
            if (details.manufacturer) {
                API.logToConsole(`│  Manufacturer: ${details.manufacturer}`);
            }
            API.logToConsole('└─');
            API.logToConsole('');
        }

        // HF-specific details
        if (result.frequency === 'HF') {
            displayHFDetails(details);
        }

        // LF-specific details
        if (result.frequency === 'LF') {
            displayLFDetails(details);
        }

        // Extracted text
        if (details.extractedText && details.extractedText.length > 0) {
            API.logToConsole('┌─ Extracted Text');
            details.extractedText.forEach((text, i) => {
                API.logToConsole(`│  [${i + 1}] "${text}"`);
            });
            API.logToConsole('└─');
            API.logToConsole('');
        }
    }

    function displayHFDetails(details) {
        if (details.totalPages) {
            API.logToConsole('┌─ Memory Structure');
            API.logToConsole(`│  Page Size: ${details.pageSize} bytes`);
            API.logToConsole(`│  Total Pages: ${details.totalPages}`);
            API.logToConsole('└─');
            API.logToConsole('');
        }

        if (details.totalBlocks) {
            API.logToConsole('┌─ Memory Structure');
            API.logToConsole(`│  Block Size: ${details.blockSize} bytes`);
            API.logToConsole(`│  Total Blocks: ${details.totalBlocks}`);
            API.logToConsole(`│  Sectors: ${details.sectors}`);
            API.logToConsole('└─');
            API.logToConsole('');
        }

        // Capability Container (NTAG)
        if (details.capabilityContainer) {
            API.logToConsole('┌─ Capability Container (CC)');
            API.logToConsole(`│  Raw: ${details.capabilityContainer.raw}`);
            API.logToConsole(`│  Magic: 0x${details.capabilityContainer.magic}`);
            API.logToConsole(`│  Version: ${details.capabilityContainer.version}`);
            API.logToConsole(`│  Memory Size: ${details.capabilityContainer.memorySize} bytes`);
            API.logToConsole(`│  Access: ${details.capabilityContainer.readWrite}`);
            API.logToConsole('└─');
            API.logToConsole('');
        }

        // Lock bytes
        if (details.lockBytes) {
            API.logToConsole('┌─ Lock Status');
            API.logToConsole(`│  Lock Bytes: ${details.lockBytes}`);
            API.logToConsole(`│  Status: ${details.isLocked ? 'Locked' : 'Unlocked'}`);
            API.logToConsole('└─');
            API.logToConsole('');
        }

        // NDEF
        if (details.hasNDEF) {
            API.logToConsole('┌─ NDEF Data');
            API.logToConsole(`│  NDEF Found: Yes`);
            API.logToConsole(`│  Offset: ${details.ndefOffset} (0x${details.ndefOffset.toString(16).padStart(4, '0')})`);
            API.logToConsole(`│  Length: ${details.ndefLength} bytes`);

            if (details.ndef) {
                API.logToConsole('│');
                API.logToConsole(`│  Record Info:`);
                API.logToConsole(`│    Type Name Format: ${details.ndef.typeNameFormatName} (0x${details.ndef.typeNameFormat.toString(16)})`);
                API.logToConsole(`│    Message Begin: ${details.ndef.messageBegin}`);
                API.logToConsole(`│    Message End: ${details.ndef.messageEnd}`);
                API.logToConsole(`│    Short Record: ${details.ndef.shortRecord}`);

                if (details.ndef.type) {
                    API.logToConsole(`│    Type: ${details.ndef.type}`);
                }

                if (details.ndef.payloadText) {
                    API.logToConsole(`│    Payload (Text): "${details.ndef.payloadText}"`);
                } else if (details.ndef.payloadHex) {
                    API.logToConsole(`│    Payload (Hex): ${details.ndef.payloadHex}`);
                }
            }

            API.logToConsole('└─');
            API.logToConsole('');
        } else if (details.hasNDEF === false) {
            API.logToConsole('┌─ NDEF Data');
            API.logToConsole('│  NDEF Found: No');
            API.logToConsole('└─');
            API.logToConsole('');
        }

        // Mifare Classic sector trailers
        if (details.sectorTrailers && details.sectorTrailers.length > 0) {
            API.logToConsole('┌─ Sector Trailers (Keys & Access Bits)');
            details.sectorTrailers.forEach(trailer => {
                API.logToConsole(`│  Sector ${trailer.sector}:`);
                API.logToConsole(`│    Key A: ${trailer.keyA}`);
                API.logToConsole(`│    Access: ${trailer.accessBits}`);
                API.logToConsole(`│    Key B: ${trailer.keyB}`);
            });
            API.logToConsole('└─');
            API.logToConsole('');
        }
    }

    function displayLFDetails(details) {
        // EM410X
        if (details.idHex) {
            API.logToConsole('┌─ EM410X Details');
            API.logToConsole(`│  ID (Hex): ${details.idHex}`);
            API.logToConsole(`│  ID (Decimal): ${details.idDecimal}`);
            if (details.version !== undefined) {
                API.logToConsole(`│  Version: 0x${details.version.toString(16).padStart(2, '0')}`);
            }
            if (details.customerId !== undefined) {
                API.logToConsole(`│  Customer ID: ${details.customerId} (0x${details.customerIdHex})`);
            }
            API.logToConsole('└─');
            API.logToConsole('');
        }

        // T5577
        if (details.blocks && details.blocks.length > 0) {
            API.logToConsole('┌─ T5577 Blocks');
            details.blocks.forEach(block => {
                API.logToConsole(`│  Block ${block.block} (${block.size} bytes):`);
                API.logToConsole(`│    ${block.hex}`);
            });
            API.logToConsole('└─');
            API.logToConsole('');
        }
    }

    // Don't log here - the device registration will log automatically
    // Programmatic access is available via window.rfidAnalyzer
}
